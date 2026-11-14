# Plan 005: A BirdNode gossips messages through a leaderless mesh, and the mesh survives nodes dying

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (edit only your own row).
>
> **Drift check (run first)**:
> 1. `grep -c "not implemented: plan 005" packages/core/src/node/index.ts` → `1`
> 2. `grep -c "not implemented" packages/core/src/codec/index.ts packages/core/src/sim/index.ts` → `0` for both files
>    (plans 002 and 004 must be DONE). If not, STOP: this plan cannot start yet.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/002-codec.md, plans/004-sim-world-and-ether.md (Step 9 also needs plans/003-modem.md)
- **Category**: direction (new feature)
- **Planned at**: no git history (greenfield), 2026-11-14

## Why this matters

BirdSong is an acoustic mesh network: phones and laptops pass encrypted text
messages to each other as birdsong. Every device runs the same engine and any
device can write, relay or read a message. There is no server, no leader and
no routing table. This plan builds that engine. It decides **when a device
sings** (listen first, back off, burst, then sing less and less often) and
**what it does with what it hears** (drop corrupted frames, collect droplets,
decrypt, relay). The headline test: in an 8-node simulated mesh, two nodes are
killed while a message is spreading, and every surviving node still gets it.

## Current state

Files you build on, all in `packages/core/src/` (read each one before starting; do not modify them):

- `types.ts` — the interface you implement. Key parts:
  ```ts
  export interface BirdNodeOptions {
    id: number; kind: NodeKind; passphrase: string; alias?: string;
    config: NodeConfig; port: AudioPort; clock: Clock; rng: () => number; modemFactory: ModemFactory;
  }
  export interface BirdNode {
    start(): Promise<void>; stop(): Promise<void>;
    send(text: string): Promise<number>;           // resolves with msgId
    configure(patch: Partial<NodeConfig>): Promise<void>;
    state(): NodeState; onEvent(cb: (e: TelemetryEvent) => void): void;
    settled(): Promise<void>;
  }
  export interface NodeConfig { env; profile; volume: number; muted: boolean; neighbors: number[] | null; camouflage: boolean }
  export interface MessageStatus { msgId; k; rank; decoded; hop; firstSeenAt; heard; sang }
  export interface InboxMessage { msgId; text; alias; hops; receivedAt; mine }
  export interface NodeState { id; species; kind; config; messages: MessageStatus[]; inbox: InboxMessage[] }
  ```
  Also `AudioPort` (`start/stop/onInput/play/setVolume/sampleRate`; `play`
  resolves when the audio finished), `Clock` (`now/setTimeout/clearTimeout`),
  `Modem` (`encode/push/onFrame/busy/reset`), `Frame`, `RxMeta`.
- `telemetry.ts` — `TelemetryEvent` union. You emit `hello`, `config`,
  `heard`, `bad` (reasons `'crc' | 'netTag' | 'neighbor' | 'auth'`), `rank`,
  `decoded`, `sang`, `expired`. Every event carries `node` (this node's id)
  and `t` (`clock.now()`).
- `codec/index.ts` (plan 002, implemented):
  `deriveChannel(pass) → { key, netTag }`, `sealMessage(ch, text, alias) → envelope`
  (throws `RangeError` for bad input), `openMessage(ch, env) → { text, alias } | null`,
  `msgIdOf(env) → number`, `splitBlocks(env) → Uint8Array[]` (k blocks of 16 B),
  `makeDroplet(blocks, seed) → Uint8Array` (seed 0..254; any k distinct seeds decode),
  `createFountainDecoder(k)` (`add(seed, payload) → boolean`, `rank`, `done`, `envelope()`),
  `encodeAirFrame(frame) → 32 bytes`, `decodeAirFrame(air) → { frame, corrected } | null`.
- `sim/index.ts` (plan 004, implemented): `createSimWorld({ sampleRate, range, noiseRms, seed })`
  with `addPort(pos)`, `setAlive`, `onSettle(fn)`, `run(ms)`, `runUntil(pred, maxMs)`,
  `clock` (a virtual clock); `createFakeModem(opts)` — exact, instant modem
  where a frame occupies the air for its real duration and overlapping frames destroy each other.
- `constants.ts` — `HOP_LIMIT = 8`, `MSG_TTL_MS = 300_000`, `SPECIES_COUNT = 4`, `MAX_SEED = 254`.
- `timing.ts` — `frameAirtimeMs(PROFILES[profile])` (fast 3010 ms, stealth 8910 ms).
- `util/prng.ts` — `mulberry32`; `util/hex.ts` — `toHex`.
- `node/index.ts` — the stub. Keep the export `createBirdNode(opts): BirdNode`.

Source-code rules (Node runs the `.ts` files directly): relative imports end
in `.ts`; type-only imports use `import type`; no `enum`, `namespace` or
constructor parameter properties. No `node:` imports in `packages/core`.
All timers go through `opts.clock`, never the global `setTimeout`; all
randomness through `opts.rng`, never `Math.random`. That is what makes the
simulation deterministic and fast.

## Commands you will need

| Purpose   | Command                                    | Expected |
|-----------|--------------------------------------------|----------|
| Typecheck | `npm run typecheck -w @birdsong/core`      | exit 0   |
| Unit      | `npx vitest run packages/core/src/node`    | all pass |
| Mesh e2e  | `npm run test:e2e`                         | all pass |

## Scope

**In scope**:
- `packages/core/src/node/` — `index.ts`, `params.ts`, `engine.ts`, `txQueue.ts`, `trickle.ts`, `*.test.ts`
- `packages/core/test/mesh.e2e.test.ts`, `packages/core/test/mesh-real.e2e.test.ts`, `packages/core/test/helpers.ts` (create)

**Out of scope**:
- `codec/`, `modem/`, `sim/`, and the contract files (`types.ts`, `telemetry.ts`, `constants.ts`, `envs.ts`, `timing.ts`).
  If a bug there blocks you, STOP and report it; do not fix it here.
- `package.json` files and the lockfile.

## Git workflow

- Commit only the in-scope paths: `git add packages/core/src/node packages/core/test && git commit -m "feat(node): <what>" -- packages/core/src/node packages/core/test`.
- Other executors (plans 006, 008, 009) may be working in this repository at
  the same time. Judge `typecheck`/`test` output only for your own directories.
- If git reports `index.lock` exists, wait 5 seconds and retry. Do NOT push.

## The protocol you are implementing

Read this whole section before writing code.

**Receive path.** For each microphone chunk: if the node is muted, or is
singing, or `clock.now() < deafUntil`, discard it. Otherwise `modem.push(chunk)`.
For each frame the modem emits:
1. `decodeAirFrame(air)`; null → emit `bad` `crc`, stop.
2. `frame.netTag !== channel.netTag` → emit `bad` `netTag`, stop.
3. `frame.sender === this.id` → stop silently (our own echo).
4. `config.neighbors !== null` and the sender is not in it → emit `bad` `neighbor`, stop.
5. Emit `heard` (`from`, `msgId`, `seed`, `hop`, `k`, `sync: meta.sync`).
6. `msgId` is in the **tombstone** set (expired) → stop.
7. Look up or create the message entry. Create it with `k = frame.k`,
   `hop = frame.hop + 1`, `firstSeenAt = now`. If an entry exists with a
   different `k`, stop. Otherwise `hop = min(hop, frame.hop + 1)`.
8. Increment the entry's `heard`, `heardSinceHeld` (only if the node already
   holds the message) and `trickleCount`.
9. If the message is not yet held: `decoder.add(seed, payload)`; if the rank
   increased, emit `rank`. If the decoder is now done → **finish** (below).

**Finish (async, tracked by `settled()`).** `env = decoder.envelope()`. If
`env` is null or `await msgIdOf(env) !== msgId`, delete the entry (it was a
msgId collision or corruption), emit `bad` `auth`, stop. `opened = await openMessage(channel, env)`;
null → delete the entry, emit `bad` `auth`, stop. Otherwise the node now
**holds** the message: store `envelope` and `blocks = splitBlocks(env)`, add an
inbox entry (`hops = entry.hop`, `mine = false`), emit `decoded`, and if
`entry.hop < HOP_LIMIT` start relaying: enqueue a **burst** of `k` droplets and
start **Trickle**.

**Send.** `send(text)`: `env = await sealMessage(channel, text, alias)`;
`msgId = await msgIdOf(env)`; create a held entry with `hop = 0`; inbox entry
with `mine = true`, `hops = 0`; emit `decoded`; enqueue a burst of `k + 1`
droplets; start Trickle. Return `msgId`.

**Transmit queue** (one frame at a time, all nodes share the air):
- Items are `{ msgId, kind: 'burst' | 'trickle' }`.
- The queue pump runs when the queue is non-empty and the node is not
  singing, not muted, and not deaf. Before each frame:
  1. Wait `LISTEN_BEFORE_MS + rng() · JITTER_MS` with the node listening.
  2. If `modem.busy()` → wait a random backoff in `[BACKOFF_MIN_MS, BACKOFF_MAX_MS]`
     and go back to 1. (After `MAX_BACKOFFS` consecutive backoffs, sing anyway,
     so one stuck-busy modem cannot freeze a node forever.)
  3. Pop the head item. Drop it (and go to the next item) if the message is no
     longer held (expired) or if it is a `burst` item and
     `entry.heardSinceHeld >= entry.k` (neighbours already sang enough droplets
     of this message; **burst suppression**).
  4. Pick a seed: a random seed in 0..MAX_SEED this node has not used for this
     message yet (retry up to 50 random draws, then scan for any unused one;
     if all 255 are used, drop the item).
  5. Build the frame `{ netTag, msgId, k, hop: entry.hop, seed, sender: id,
     payload: makeDroplet(blocks, seed) }`, `air = encodeAirFrame(frame)`,
     `pcm = modem.encode(air, species)`.
  6. `singing = true`; `await port.play(pcm)`; `singing = false`;
     `deafUntil = now + DEAF_TAIL_MS`; schedule `modem.reset()` at `deafUntil`.
     Increment `entry.sang`; emit `sang` with `airHex = toHex(air)` and
     `durationMs = pcm.length / sampleRate · 1000`.
  7. Continue pumping.

**Trickle** (per held message, slows down over time; stops at expiry):
- Start with interval `I = TRICKLE_IMIN_MS`. At the start of each interval set
  `trickleCount = 0` and pick `t = I/2 + rng() · I/2`.
- At time `t` into the interval: if `trickleCount < TRICKLE_K` and there is no
  queued item for this message, enqueue one `trickle` item.
- At the end of the interval: `I = min(2I, TRICKLE_IMAX_MS)`, start the next interval.
- `MSG_TTL_MS` after the message became held: stop Trickle, remove queued
  items, delete the entry, add `msgId` to the tombstone set (keep at most 1024
  tombstones, oldest dropped first), emit `expired`. The inbox entry stays.
- Non-held entries (partial rank) that are older than `MSG_TTL_MS` are deleted
  silently, without a tombstone, by a sweep every 10 s.

**Configure.** `configure(patch)`: merge into the config; clamp `volume` to
0..1 and call `port.setVolume`. If `env` or `profile` changed: create a new
modem with `modemFactory({ sampleRate: port.sampleRate, env, profile })` and
register `onFrame` again (the old modem is dropped). Muting stops listening and
pauses the transmit pump (queue kept); unmuting resumes it. Emit `config`.

**Events.** `onEvent(cb)` **adds** a listener; any number may be registered
and every listener receives every event, in registration order. A listener
that throws must not stop the others (catch and ignore). The Docker runtime
registers four listeners, the web app two.

**Lifecycle.** `start()`: derive the channel, create the modem, register
`port.onInput`, `await port.start()`, start the 10 s sweep, emit `hello`.
`stop()`: cancel every timer, `await port.stop()`. `species = id % SPECIES_COUNT`.
`alias = opts.alias ?? 'bird' + id`. `settled()` resolves once every tracked
promise (finish, send) has completed, including ones added while waiting.

Parameters go in `node/params.ts`, exported as a single object:

```ts
export const NODE_PARAMS = {
  LISTEN_BEFORE_MS: 200,
  JITTER_MS: 400,
  BACKOFF_MIN_MS: 500,
  BACKOFF_MAX_MS: 3000,
  MAX_BACKOFFS: 20,
  DEAF_TAIL_MS: 150,
  TRICKLE_IMIN_MS: 10_000,
  TRICKLE_IMAX_MS: 60_000,
  TRICKLE_K: 2,
  SWEEP_MS: 10_000,
};
```

## Steps

### Step 1: Trickle timer — `trickle.ts`

A small class-free module: `createTrickle(clock, rng, params, onFire: () => void)`
returning `{ start(), stop(), heard() }` where `heard()` increments the
interval's counter and `onFire` is called at time `t` only if the counter is
below `TRICKLE_K`. Implement exactly the Trickle rules above.

Tests (`trickle.test.ts`, with `createVirtualClock` and `mulberry32`): with no
`heard()` calls, the intervals are [0, 10), [10, 30), [30, 70), [70, 130),
[130, 190), … (seconds after start) and the fires fall in the second half of
each: [5, 10), [20, 30), [50, 70), [100, 130), [160, 190), …; calling `heard()`
twice early in an interval suppresses that interval's fire; `stop()` prevents
further fires.

**Verify**: `npx vitest run packages/core/src/node/trickle.test.ts` → all pass.

### Step 2: Transmit queue — `txQueue.ts`

Pure data structure: `push(item)`, `shift()`, `has(msgId)`, `removeMsg(msgId)`,
`length`. Tests for each. (The pump logic lives in `engine.ts`.)

**Verify**: `npx vitest run packages/core/src/node/txQueue.test.ts` → all pass.

### Step 3: Engine — `engine.ts`, `index.ts`

Implement `createBirdNode` exactly as described in "The protocol you are
implementing". Keep the state per message in a `Map<number, Entry>` where
`Entry` holds: `msgId, k, hop, firstSeenAt, heldAt, heard, sang, heardSinceHeld,
decoder, envelope, blocks, usedSeeds: Set<number>, trickle, expiryTimer`.
`state()` returns copies (no internal objects leak out).

`index.ts`: `export { createBirdNode } from './engine.ts'; export { NODE_PARAMS } from './params.ts';`

**Verify**: `npm run typecheck -w @birdsong/core` → exit 0.

### Step 4: Test helpers — `packages/core/test/helpers.ts`

```ts
export interface Mesh { world: SimWorld; nodes: BirdNode[]; events: TelemetryEvent[] }
/** positions[i] is node i's position. All nodes share `passphrase` unless overridden. */
export async function buildMesh(opts: {
  positions: Position[]; range?: number; seed?: number;
  passphrase?: string; perNode?: (i: number) => Partial<BirdNodeOptions>;
  modemFactory?: ModemFactory; sampleRate?: number; noiseRms?: number;
  env?: EnvName; profile?: ProfileName;
}): Promise<Mesh>
export function decodedBy(mesh: Mesh, msgId: number): Set<number>  // node ids with a 'decoded' event for msgId
```

Defaults: `range 1.2`, `sampleRate 8000`, `modemFactory createFakeModem`, `noiseRms 0`,
`env 'quiet'`, `profile 'fast'`, `seed 1`, passphrase `'test-flock'`.
Where a test below gives no text, send `"hi"` (the smallest message: k = 2,
because the alias and the 14-byte envelope overhead always fill more than one block). Each node
gets `rng: mulberry32(seed * 1000 + i)`, `clock: world.clock`, `kind: 'sim'`,
`id: i`. Register `world.onSettle(() => node.settled())` for every node; push
every node's events into `events`; `await node.start()` for all.

(The fake modem ignores `env`, so `'quiet'` at 8000 Hz is fine with it. With
the real modem use `env: 'coast'`, whose band fits under 4 kHz.)

### Step 5: Unit tests — `packages/core/src/node/engine.test.ts`

Use `buildMesh`. One `it` per case:
1. **Two nodes** 1 apart: node 0 sends `"hello flock"` → node 1's inbox has it within 60 s of virtual time
   (`world.runUntil(() => …, 60_000)` returns true); node 0's inbox has it with `mine: true`; node 1's `hops === 1`.
2. **Half-duplex**: across the whole run of case 1, no `heard` event has `from === node`.
3. **Wrong passphrase**: node 1 uses `'other'` → never decodes, emits `bad` `netTag`, emits no `sang`.
4. **Muted node**: node 1 starts with `muted: true` → no `heard`, no `sang`.
5. **Neighbours filter**: three nodes all within range; node 2 has `neighbors: [1]`.
   Node 0 sends → node 2 decodes; the first `heard` event at node 2 has `from === 1`; node 2 emits `bad` `neighbor`.
6. **Burst suppression / airtime**: 6 nodes all within range of each other
   (positions on a circle of radius 0.4). Node 0 sends a 30-character text.
   Within 60 s all decode, and the total number of `sang` events across all
   nodes in that time is at most `2 * k + 6` (read `k` from node 0's `state()`).
   Without burst suppression it would be at least `6 * k + 1`; log both numbers.
7. **Expiry**: two nodes; after send, `world.run(MSG_TTL_MS + 20_000)`: both
   emit `expired`; after another `world.run(120_000)` no new `sang` events for
   that msgId; the inbox entries are still there.
8. **Validation**: `send('')` and a 141-character text reject with `RangeError`.
9. **Several listeners**: two `onEvent` listeners on node 1 both receive the `decoded` event; a third listener that throws does not stop them.

**Verify**: `npx vitest run packages/core/src/node` → all pass.

### Step 6: Mesh end-to-end tests — `packages/core/test/mesh.e2e.test.ts`

These are the tests that prove the "systems keep working when communication is
interrupted" claim. Each one: fake modem, `noiseRms 0`.

1. **Line, multi-hop**: 5 nodes at x = 0..4 (y = 0), range 1.2 (each node only
   hears its direct neighbours). Node 0 sends → node 4 decodes within 180 s;
   its `hops === 4`.
2. **Kill two relays mid-flight (headline)**: 8 nodes on a 2 × 4 grid,
   node `i` at `(i % 4, floor(i / 4))`, range 1.5 (orthogonal and diagonal
   neighbours only). Node 0 sends a 40-character text. At virtual time 4 s
   (`world.run(4000)`), mute nodes 1 and 6 (`configure({ muted: true })`) and
   call `world.setAlive(1, false)` and `world.setAlive(6, false)`. Then
   `runUntil` every node in {2, 3, 4, 5, 7} has decoded, max 240 s → true.
3. **Originator dies after its burst**: the line of case 1. Run until node 1
   has decoded, then kill node 0 (mute + `setAlive(0, false)`). Node 4 still decodes within 240 s.
4. **Two writers at once**: 4 nodes within range of each other; nodes 0 and 3
   both call `send` at time 0. Within 240 s every node has both messages in its inbox.
5. **Late joiner**: 3 nodes in a line, node 2 starts muted; node 0 sends `"hi"`
   (k = 2). After node 1 has decoded, wait 30 s, unmute node 2 → node 2 decodes
   within 240 s (Trickle keeps the message alive, but by then node 1 sings only
   one droplet per 40–60 s interval, so this is slow by design).

Print, with `console.log`, the virtual time at which each case finished, so
the numbers can go into the pitch.

**Verify**: `npm run test:e2e` → all 5 pass, and the whole file takes under 120 s of wall time.

### Step 7: Speed check

**Verify**: `time npx vitest run --config vitest.e2e.config.ts packages/core/test/mesh.e2e.test.ts`
→ under 120 s real time. If slower, profile the fake modem and the world loop
first (they run per sample); do not raise timeouts.

### Step 8: Full check

**Verify**: `npm test` → all pass (other packages included).
**Verify**: `grep -rnE "Math\.random|(^|[^.a-zA-Z])setTimeout\(" packages/core/src/node --include=*.ts | grep -v "\.test\.ts" | wc -l` → `0`
(only `clock.setTimeout(...)` is allowed; the pattern does not match it).

### Step 9: The same mesh with the real modem — `packages/core/test/mesh-real.e2e.test.ts`

Only do this step if `grep -c "not implemented" packages/core/src/modem/index.ts` → `0`
(plan 003 DONE). Otherwise write the file with the test wrapped in
`it.skip` and a comment `// enable when plan 003 is DONE`, and note it in `plans/README.md`.

Test: 3 nodes in a line at x = 0, 1, 2, range 1.2, `modemFactory: createModem`
(from `../src/modem/index.ts`), `sampleRate 8000`, `env 'coast'`, `profile 'fast'`,
`noiseRms 0.003`. Node 0 sends a 20-character text → node 2 decodes within 150 s.
Timeout 300 s.

**Verify**: `npx vitest run --config vitest.e2e.config.ts packages/core/test/mesh-real.e2e.test.ts` → passes (or is skipped, per above).

## Test plan

- Unit: `trickle.test.ts`, `txQueue.test.ts`, `engine.test.ts` (9 cases) in `packages/core/src/node/`.
- E2E: `mesh.e2e.test.ts` (5 cases), `mesh-real.e2e.test.ts` (1 case) in `packages/core/test/`.

## Done criteria

- [ ] `npx vitest run packages/core/src/node` exits 0
- [ ] `npm run test:e2e` exits 0 and includes the 5 mesh cases
- [ ] `npm run typecheck -w @birdsong/core` exits 0
- [ ] `grep -c "not implemented" packages/core/src/node/index.ts` → `0`
- [ ] `git status --porcelain -- package.json package-lock.json packages/core/src/constants.ts packages/core/src/types.ts packages/core/src/telemetry.ts packages/core/src/codec packages/core/src/sim packages/core/src/modem` prints nothing (you changed no file you do not own)
- [ ] `git log -1 --name-only` lists only files under `packages/core/src/node/` and `packages/core/test/` (and `plans/README.md` if you committed it)
- [ ] `plans/README.md` status row updated, with the finish times printed by Step 6 copied into "Notes from executors"

## STOP conditions

- E2E case 2 (kill two relays) fails after you have checked the topology
  arithmetic by hand. Report which nodes decoded and the event log tail; do
  not change the topology to make it pass.
- Making a test pass seems to need a change to the fake modem or the sim world
  (plan 004) or the codec (plan 002). Report the suspected bug instead.
- The simulation is not deterministic: the same test gives different decode
  times across two runs (the random nonce changes msgIds, which is expected;
  decode **times** must not change). Investigate for use of `Math.random` or
  real timers first; if you cannot find the cause, STOP.

## Maintenance notes

- Burst suppression counts droplets heard from anyone. In a hidden-terminal
  layout (B hears A, C hears only B) B still bursts, because it hears at most
  one of A's droplets after decoding. If burst sizes change, re-check E2E case 1.
- Trickle and TTL values are tuned for demo-sized meshes (≤ 15 nodes). Bigger
  meshes want a larger `TRICKLE_K` and longer intervals.
- Deferred: relaying from a partial rank (network coding), "I'm missing
  droplets" control frames (`k = 0` is reserved for them), and duty-cycle limits.
