import type { AudioPort } from '../types.ts';
import { createVirtualClock } from '../util/clock.ts';
import type { VirtualClock } from '../util/clock.ts';
import { mulberry32 } from '../util/prng.ts';
import { gainBetween, mixBlock } from './mix.ts';
import type { Position } from './mix.ts';

export interface SimWorldOptions {
  sampleRate: number;        // use 8000 with the fake modem to keep tests fast
  blockMs?: number;          // default 20
  range?: number;            // default 1.2
  noiseRms?: number;         // default 0
  seed?: number;             // default 1
}
export interface SimPort extends AudioPort {
  readonly index: number;
  /** Total samples this port has played so far. */
  readonly samplesPlayed: number;
}
export interface SimWorld {
  readonly clock: VirtualClock;
  /** Add a node at a position. Returns its audio port. */
  addPort(pos: Position): SimPort;
  /** A dead port plays nothing and hears nothing. play() on a dead port still resolves after the audio's duration. */
  setAlive(index: number, alive: boolean): void;
  /** Called after every block; the world awaits all of them before continuing. */
  onSettle(fn: () => Promise<void>): void;
  /** Simulate `ms` of time. */
  run(ms: number): Promise<void>;
  /** Simulate until `pred()` is true (checked after every block) or `maxMs` passed. Returns whether it became true. */
  runUntil(pred: () => boolean, maxMs: number): Promise<boolean>;
}

interface QueueItem { pcm: Float32Array; offset: number; resolve: () => void }
interface PortState {
  pos: Position;
  alive: boolean;
  started: boolean;
  volume: number;
  cb: ((pcm: Float32Array) => void) | null;
  queue: QueueItem[];
  played: number;
}

function yieldMacrotask(): Promise<void> {
  return typeof setImmediate === 'function'
    ? new Promise<void>((r) => { setImmediate(r); })
    : new Promise<void>((r) => { setTimeout(r, 0); });
}

export function createSimWorld(opts: SimWorldOptions): SimWorld {
  const sampleRate = opts.sampleRate;
  const blockMs = opts.blockMs ?? 20;
  const range = opts.range ?? 1.2;
  const noiseRms = opts.noiseRms ?? 0;
  const rng = mulberry32(opts.seed ?? 1);
  const B = Math.round(blockMs * sampleRate / 1000);
  const clock = createVirtualClock(0);
  const ports: PortState[] = [];
  const hooks: Array<() => Promise<void>> = [];
  let gains: number[][] = [];

  function recompute() {
    gains = ports.map((p, j) => ports.map((q, i) =>
      (i === j || !p.alive || !q.alive) ? 0 : gainBetween(p.pos, q.pos, range)));
  }

  async function block() {
    const n = ports.length;
    const tx: Float32Array[] = [];
    const finished: Array<() => void> = [];
    for (let j = 0; j < n; j++) {
      const p = ports[j]!;
      const out = new Float32Array(B);
      let filled = 0;
      while (filled < B && p.queue.length > 0) {
        const item = p.queue[0]!;
        const take = Math.min(B - filled, item.pcm.length - item.offset);
        if (p.alive) {
          for (let k = 0; k < take; k++) out[filled + k] = item.pcm[item.offset + k]! * p.volume;
        }
        item.offset += take;
        filled += take;
        p.played += take;
        if (item.offset >= item.pcm.length) {
          p.queue.shift();
          finished.push(item.resolve);
        }
      }
      tx.push(out);
    }
    const rx = mixBlock(tx, gains, noiseRms, rng);
    for (let i = 0; i < n; i++) {
      const p = ports[i]!;
      if (p.alive && p.started && p.cb) p.cb(rx[i]!);
    }
    for (const r of finished) r();
    clock.advance(blockMs);
    for (let rep = 0; rep < 2; rep++) {
      await yieldMacrotask();
      for (const h of hooks) await h();
    }
  }

  async function runUntil(pred: () => boolean, maxMs: number): Promise<boolean> {
    const blocks = Math.ceil(maxMs / blockMs);
    for (let b = 0; b < blocks; b++) {
      await block();
      if (pred()) return true;
    }
    return false;
  }

  return {
    clock,
    addPort(pos) {
      const index = ports.length;
      const st: PortState = { pos, alive: true, started: false, volume: 1, cb: null, queue: [], played: 0 };
      ports.push(st);
      recompute();
      return {
        index,
        sampleRate,
        get samplesPlayed() { return st.played; },
        async start() { st.started = true; },
        async stop() { st.started = false; },
        onInput(cb) { st.cb = cb; },
        play(pcm) {
          return new Promise<void>((resolve) => {
            if (pcm.length === 0) { resolve(); return; }
            st.queue.push({ pcm, offset: 0, resolve });
          });
        },
        setVolume(v) { st.volume = v; },
      };
    },
    setAlive(index, alive) {
      ports[index]!.alive = alive;
      recompute();
    },
    onSettle(fn) { hooks.push(fn); },
    async run(ms) {
      await runUntil(() => false, ms);
    },
    runUntil,
  };
}
