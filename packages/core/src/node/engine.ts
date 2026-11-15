import { HOP_LIMIT, MAX_SEED, MSG_TTL_MS, SPECIES_COUNT } from '../constants.ts';
import {
  createFountainDecoder,
  decodeAirFrame,
  deriveChannel,
  encodeAirFrame,
  makeDroplet,
  msgIdOf,
  openMessage,
  sealMessage,
  splitBlocks,
} from '../codec/index.ts';
import type { Channel, FountainDecoder } from '../codec/index.ts';
import type {
  BirdNode,
  BirdNodeOptions,
  InboxMessage,
  MessageStatus,
  Modem,
  NodeConfig,
  NodeState,
  RxMeta,
  TimerId,
} from '../types.ts';
import { DEFAULT_NODE_CONFIG } from '../types.ts';
import type { TelemetryEvent } from '../telemetry.ts';
import { toHex } from '../util/hex.ts';
import { NODE_PARAMS } from './params.ts';
import { createTrickle } from './trickle.ts';
import type { Trickle } from './trickle.ts';
import { createTxQueue } from './txQueue.ts';

const MAX_TOMBSTONES = 1024;
const SEED_RANDOM_DRAWS = 50;

interface Entry {
  msgId: number;
  k: number;
  hop: number;
  firstSeenAt: number;
  heldAt: number | null;
  heard: number;
  sang: number;
  heardSinceHeld: number;
  trickleCount: number;
  finishing: boolean;
  decoder: FountainDecoder;
  envelope: Uint8Array | null;
  blocks: Uint8Array[] | null;
  usedSeeds: Set<number>;
  trickle: Trickle | null;
  expiryTimer: TimerId | null;
  /** Full copies heard since held that were already counted as receptions. */
  copies: number;
  /** Inbox row this message belongs to (same alias and text), once held. */
  inboxKey: string | null;
  /** Stopped relaying: received more than config.relayLimit times. */
  suppressed: boolean;
}

const rowKey = (alias: string, text: string): string => `${alias}\u0000${text}`;

function clampLimit(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function copyConfig(c: NodeConfig): NodeConfig {
  return { ...c, neighbors: c.neighbors === null ? null : [...c.neighbors] };
}

export function createBirdNode(opts: BirdNodeOptions): BirdNode {
  const P = NODE_PARAMS;
  const { id, kind, clock, rng, port } = opts;
  const species = id % SPECIES_COUNT;
  const alias = opts.alias ?? 'bird' + id;
  const config: NodeConfig = copyConfig(opts.config);
  config.volume = Math.min(1, Math.max(0, config.volume));
  config.relayLimit = clampLimit(config.relayLimit, DEFAULT_NODE_CONFIG.relayLimit);

  const listeners: Array<(e: TelemetryEvent) => void> = [];
  const entries = new Map<number, Entry>();
  const tombstones = new Set<number>();
  const inbox: InboxMessage[] = [];
  /** Inbox rows by alias + text, so a repeated message adds to a count instead of a new row. */
  const rows = new Map<string, InboxMessage>();
  const queue = createTxQueue();
  const tracked = new Set<Promise<unknown>>();

  let channelPromise: Promise<Channel> | null = null;
  let channel: Channel | null = null;
  let modem: Modem | null = null;
  let started = false;
  let stopped = false;
  let singing = false;
  let deafUntil = -Infinity;
  let pumpTimer: TimerId | null = null;
  let resetTimer: TimerId | null = null;
  let sweepTimer: TimerId | null = null;
  let backoffs = 0;

  function emit(e: TelemetryEvent): void {
    for (const cb of listeners) {
      try {
        cb(e);
      } catch {
        // a throwing listener must not stop the others
      }
    }
  }

  function track<T>(p: Promise<T>): Promise<T> {
    tracked.add(p);
    const done = () => {
      tracked.delete(p);
    };
    p.then(done, done);
    return p;
  }

  function getChannel(): Promise<Channel> {
    if (!channelPromise) {
      channelPromise = deriveChannel(opts.passphrase).then((c) => {
        channel = c;
        return c;
      });
    }
    return channelPromise;
  }

  // ---------------------------------------------------------------- modem

  function makeModem(): Modem {
    const m = opts.modemFactory({ sampleRate: port.sampleRate, env: config.env, profile: config.profile });
    m.onFrame((air, meta) => {
      if (m === modem) onFrame(air, meta);
    });
    return m;
  }

  function onInput(chunk: Float32Array): void {
    if (stopped || config.muted || singing || clock.now() < deafUntil || !modem) return;
    modem.push(chunk);
  }

  // -------------------------------------------------------------- receive

  function onFrame(air: Uint8Array, meta: RxMeta): void {
    if (stopped || !channel) return;
    const now = clock.now();
    const dec = decodeAirFrame(air);
    if (!dec) {
      emit({ type: 'bad', node: id, reason: 'crc', t: now });
      return;
    }
    const frame = dec.frame;
    if (frame.netTag !== channel.netTag) {
      emit({ type: 'bad', node: id, reason: 'netTag', t: now });
      return;
    }
    if (frame.sender === id) return;
    if (config.neighbors !== null && !config.neighbors.includes(frame.sender)) {
      emit({ type: 'bad', node: id, reason: 'neighbor', t: now });
      return;
    }
    emit({
      type: 'heard', node: id, from: frame.sender, msgId: frame.msgId, seed: frame.seed,
      hop: frame.hop, k: frame.k, sync: meta.sync, t: now,
    });
    if (frame.k < 1) return; // control frames are reserved
    if (tombstones.has(frame.msgId)) return;

    let entry = entries.get(frame.msgId);
    if (!entry) {
      entry = {
        msgId: frame.msgId, k: frame.k, hop: frame.hop + 1, firstSeenAt: now, heldAt: null,
        heard: 0, sang: 0, heardSinceHeld: 0, trickleCount: 0, finishing: false,
        decoder: createFountainDecoder(frame.k), envelope: null, blocks: null,
        usedSeeds: new Set(), trickle: null, expiryTimer: null, copies: 0, inboxKey: null, suppressed: false,
      };
      entries.set(frame.msgId, entry);
    } else if (entry.k !== frame.k) {
      return;
    } else {
      entry.hop = Math.min(entry.hop, frame.hop + 1);
    }

    const held = entry.envelope !== null;
    entry.heard++;
    if (held) entry.heardSinceHeld++;
    entry.trickleCount++;
    if (entry.trickle) entry.trickle.heard();
    if (held) {
      creditCopies(entry);
      return;
    }

    if (entry.decoder.add(frame.seed, frame.payload)) {
      emit({ type: 'rank', node: id, msgId: entry.msgId, rank: entry.decoder.rank, k: entry.k, t: now });
    }
    if (entry.decoder.done && !entry.finishing) {
      entry.finishing = true;
      const e = entry;
      track(finish(e).catch(() => undefined));
    }
  }

  async function finish(entry: Entry): Promise<void> {
    const env = entry.decoder.envelope();
    const authFail = () => {
      if (entries.get(entry.msgId) === entry) entries.delete(entry.msgId);
      emit({ type: 'bad', node: id, reason: 'auth', t: clock.now() });
    };
    if (!env || (await msgIdOf(env)) !== entry.msgId) {
      authFail();
      return;
    }
    const opened = await openMessage(channel!, env);
    if (stopped || entries.get(entry.msgId) !== entry) return;
    if (!opened) {
      authFail();
      return;
    }
    const now = clock.now();
    becomeHeld(entry, env);
    const key = rowKey(opened.alias, opened.text);
    entry.inboxKey = key;
    const row = rows.get(key);
    if (row) {
      row.count++;
      row.hops = Math.min(row.hops, entry.hop);
    } else {
      const fresh: InboxMessage = {
        msgId: entry.msgId, text: opened.text, alias: opened.alias, hops: entry.hop, receivedAt: now, mine: false,
        count: 1, suppressed: false,
      };
      inbox.push(fresh);
      rows.set(key, fresh);
    }
    emit({
      type: 'decoded', node: id, msgId: entry.msgId, hops: entry.hop, text: opened.text, alias: opened.alias, t: now,
    });
    if (overLimit(key)) {
      // Already heard this text often enough: keep it, but do not relay this copy either.
      enforceLimit(key);
      return;
    }
    if (entry.hop < HOP_LIMIT) {
      enqueueBurst(entry, entry.k);
      startTrickle(entry);
    }
  }

  // ------------------------------------------------------ relay limit

  function overLimit(key: string): boolean {
    const row = rows.get(key);
    return row !== undefined && config.relayLimit > 0 && row.count > config.relayLimit;
  }

  /** Every k droplets heard after decoding count as one more reception of the message. */
  function creditCopies(entry: Entry): void {
    const copies = Math.floor(entry.heardSinceHeld / Math.max(1, entry.k));
    if (copies <= entry.copies) return;
    const delta = copies - entry.copies;
    entry.copies = copies;
    const row = entry.inboxKey === null ? undefined : rows.get(entry.inboxKey);
    if (!row) return;
    row.count += delta;
    if (overLimit(entry.inboxKey!)) enforceLimit(entry.inboxKey!);
  }

  /** Stop relaying every held message of this inbox row. */
  function enforceLimit(key: string): void {
    for (const e of entries.values()) if (e.inboxKey === key && e.envelope && !e.suppressed) suppress(e);
  }

  function suppress(entry: Entry): void {
    entry.suppressed = true;
    entry.trickle?.stop();
    queue.removeMsg(entry.msgId);
    const count = rows.get(entry.inboxKey ?? '')?.count ?? 0;
    emit({ type: 'relay', node: id, msgId: entry.msgId, active: false, count, t: clock.now() });
  }

  function resume(entry: Entry): void {
    entry.suppressed = false;
    const count = rows.get(entry.inboxKey ?? '')?.count ?? 0;
    emit({ type: 'relay', node: id, msgId: entry.msgId, active: true, count, t: clock.now() });
    if (entry.hop >= HOP_LIMIT) return;
    if (entry.trickle) entry.trickle.start();
    else startTrickle(entry);
  }

  /** After relayLimit changes: stop or resume each held message to match. */
  function reapplyLimit(): void {
    for (const e of entries.values()) {
      if (!e.envelope || e.inboxKey === null) continue;
      const over = overLimit(e.inboxKey);
      if (over && !e.suppressed) suppress(e);
      else if (!over && e.suppressed) resume(e);
    }
  }

  // ----------------------------------------------------------- holding

  function becomeHeld(entry: Entry, env: Uint8Array): void {
    entry.envelope = env;
    entry.blocks = splitBlocks(env);
    entry.heldAt = clock.now();
    entry.heardSinceHeld = 0;
    entry.expiryTimer = clock.setTimeout(() => expire(entry), MSG_TTL_MS);
  }

  function enqueueBurst(entry: Entry, count: number): void {
    for (let i = 0; i < count; i++) queue.push({ msgId: entry.msgId, kind: 'burst' });
    pumpStart();
  }

  function startTrickle(entry: Entry): void {
    entry.trickle = createTrickle(clock, rng, P, () => {
      if (stopped || entry.suppressed || entries.get(entry.msgId) !== entry) return;
      if (!queue.has(entry.msgId)) {
        queue.push({ msgId: entry.msgId, kind: 'trickle' });
        pumpStart();
      }
    });
    entry.trickle.start();
  }

  function expire(entry: Entry): void {
    entry.expiryTimer = null;
    if (entries.get(entry.msgId) !== entry) return;
    entry.trickle?.stop();
    queue.removeMsg(entry.msgId);
    entries.delete(entry.msgId);
    tombstones.add(entry.msgId);
    if (tombstones.size > MAX_TOMBSTONES) {
      const oldest = tombstones.values().next().value;
      if (oldest !== undefined) tombstones.delete(oldest);
    }
    emit({ type: 'expired', node: id, msgId: entry.msgId, t: clock.now() });
  }

  function sweep(): void {
    sweepTimer = null;
    if (stopped) return;
    const now = clock.now();
    for (const [msgId, e] of entries) {
      if (e.envelope === null && !e.finishing && now - e.firstSeenAt > MSG_TTL_MS) entries.delete(msgId);
    }
    sweepTimer = clock.setTimeout(sweep, P.SWEEP_MS);
  }

  // ------------------------------------------------------------- transmit

  function canPump(): boolean {
    return started && !stopped && !singing && !config.muted && queue.length > 0;
  }

  function pumpStart(): void {
    if (pumpTimer !== null || !canPump()) return;
    backoffs = 0;
    scheduleListen();
  }

  function scheduleListen(): void {
    pumpTimer = clock.setTimeout(onListenDone, P.LISTEN_BEFORE_MS + rng() * P.JITTER_MS);
  }

  function onListenDone(): void {
    pumpTimer = null;
    if (stopped || config.muted || singing) return;
    const now = clock.now();
    if (now < deafUntil) {
      pumpTimer = clock.setTimeout(onListenDone, deafUntil - now);
      return;
    }
    if (modem && modem.busy() && backoffs < P.MAX_BACKOFFS) {
      backoffs++;
      pumpTimer = clock.setTimeout(scheduleListen, P.BACKOFF_MIN_MS + rng() * (P.BACKOFF_MAX_MS - P.BACKOFF_MIN_MS));
      return;
    }
    backoffs = 0;
    let entry: Entry | undefined;
    let seed = -1;
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const e = entries.get(item.msgId);
      if (!e || !e.envelope || !e.blocks || e.suppressed) continue;
      if (item.kind === 'burst' && e.heardSinceHeld >= e.k) continue;
      const s = pickSeed(e);
      if (s < 0) continue;
      entry = e;
      seed = s;
      break;
    }
    void sing(entry, seed);
  }

  function pickSeed(entry: Entry): number {
    for (let i = 0; i < SEED_RANDOM_DRAWS; i++) {
      const s = Math.floor(rng() * (MAX_SEED + 1));
      if (!entry.usedSeeds.has(s)) return s;
    }
    for (let s = 0; s <= MAX_SEED; s++) if (!entry.usedSeeds.has(s)) return s;
    return -1;
  }

  async function sing(entry: Entry, seed: number): Promise<void> {
    if (!modem || !channel) return;
    entry.usedSeeds.add(seed);
    const air = encodeAirFrame({
      netTag: channel.netTag, msgId: entry.msgId, k: entry.k, hop: entry.hop, seed, sender: id,
      payload: makeDroplet(entry.blocks!, seed),
    });
    const pcm = modem.encode(air, species);
    emit({
      type: 'singing', node: id, msgId: entry.msgId, seed, hop: entry.hop, k: entry.k,
      durationMs: (pcm.length / port.sampleRate) * 1000, t: clock.now(),
    });
    singing = true;
    try {
      await port.play(pcm);
    } finally {
      singing = false;
    }
    if (stopped) return;
    const now = clock.now();
    deafUntil = now + P.DEAF_TAIL_MS;
    if (resetTimer !== null) clock.clearTimeout(resetTimer);
    resetTimer = clock.setTimeout(() => {
      resetTimer = null;
      modem?.reset();
    }, P.DEAF_TAIL_MS);
    entry.sang++;
    emit({
      type: 'sang', node: id, msgId: entry.msgId, seed, hop: entry.hop, k: entry.k,
      airHex: toHex(air), durationMs: (pcm.length / port.sampleRate) * 1000, t: now,
    });
    pumpStart();
  }

  // ------------------------------------------------------------------ API

  function snapshotConfig(): NodeConfig {
    return copyConfig(config);
  }

  const node: BirdNode = {
    async start() {
      if (started) return;
      started = true;
      stopped = false;
      await getChannel();
      modem = makeModem();
      port.setVolume(config.volume);
      port.onInput(onInput);
      await port.start();
      sweepTimer = clock.setTimeout(sweep, P.SWEEP_MS);
      emit({ type: 'hello', node: id, species, kind, config: snapshotConfig(), t: clock.now() });
      pumpStart();
    },

    async stop() {
      stopped = true;
      started = false;
      for (const t of [pumpTimer, resetTimer, sweepTimer]) if (t !== null) clock.clearTimeout(t);
      pumpTimer = null;
      resetTimer = null;
      sweepTimer = null;
      for (const e of entries.values()) {
        e.trickle?.stop();
        if (e.expiryTimer !== null) clock.clearTimeout(e.expiryTimer);
        e.expiryTimer = null;
      }
      await port.stop();
    },

    send(text) {
      return track(
        (async () => {
          const ch = await getChannel();
          const env = await sealMessage(ch, text, alias);
          const msgId = await msgIdOf(env);
          const now = clock.now();
          tombstones.delete(msgId);
          const old = entries.get(msgId);
          if (old) {
            old.trickle?.stop();
            if (old.expiryTimer !== null) clock.clearTimeout(old.expiryTimer);
            queue.removeMsg(msgId);
          }
          const blocks = splitBlocks(env);
          const decoder = createFountainDecoder(blocks.length);
          const entry: Entry = {
            msgId, k: blocks.length, hop: 0, firstSeenAt: now, heldAt: null, heard: 0, sang: 0,
            heardSinceHeld: 0, trickleCount: 0, finishing: false, decoder, envelope: null, blocks: null,
            usedSeeds: new Set(), trickle: null, expiryTimer: null, copies: 0, inboxKey: null, suppressed: false,
          };
          entries.set(msgId, entry);
          becomeHeld(entry, env);
          // Sending a text again reuses its inbox row; the count restarts, since this is a fresh send.
          const key = rowKey(alias, text);
          entry.inboxKey = key;
          const row = rows.get(key);
          if (row) {
            row.msgId = msgId;
            row.hops = 0;
            row.mine = true;
            row.receivedAt = now;
            row.count = 0;
          } else {
            const fresh: InboxMessage = { msgId, text, alias, hops: 0, receivedAt: now, mine: true, count: 0, suppressed: false };
            inbox.push(fresh);
            rows.set(key, fresh);
          }
          emit({ type: 'decoded', node: id, msgId, hops: 0, text, alias, t: now });
          enqueueBurst(entry, entry.k + 1);
          startTrickle(entry);
          return msgId;
        })(),
      );
    },

    async configure(patch) {
      const prev = snapshotConfig();
      const next: NodeConfig = { ...config, ...patch };
      next.volume = Math.min(1, Math.max(0, next.volume));
      next.relayLimit = clampLimit(next.relayLimit, prev.relayLimit);
      next.neighbors = next.neighbors === null ? null : [...next.neighbors];
      Object.assign(config, next);
      port.setVolume(config.volume);
      if (config.env !== prev.env || config.profile !== prev.profile) {
        if (started) modem = makeModem();
      }
      if (config.muted && !prev.muted) {
        if (pumpTimer !== null) clock.clearTimeout(pumpTimer);
        pumpTimer = null;
        modem?.reset();
      } else if (!config.muted && prev.muted) {
        modem?.reset();
        pumpStart();
      }
      if (config.relayLimit !== prev.relayLimit) reapplyLimit();
      emit({ type: 'config', node: id, config: snapshotConfig(), t: clock.now() });
    },

    state(): NodeState {
      const messages: MessageStatus[] = [];
      for (const e of entries.values()) {
        const held = e.envelope !== null;
        messages.push({
          msgId: e.msgId, k: e.k, rank: held ? e.k : e.decoder.rank, decoded: held, hop: e.hop,
          firstSeenAt: e.firstSeenAt, heard: e.heard, sang: e.sang, suppressed: e.suppressed,
        });
      }
      const rowsOut = inbox.map((m) => ({ ...m, suppressed: overLimit(rowKey(m.alias, m.text)) }));
      return { id, species, kind, config: snapshotConfig(), messages, inbox: rowsOut };
    },

    onEvent(cb) {
      listeners.push(cb);
    },

    async settled() {
      while (tracked.size > 0) await Promise.allSettled([...tracked]);
    },
  };
  return node;
}
