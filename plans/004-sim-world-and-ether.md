# Plan 004: A simulated "air" exists — in-process for tests, and as a service for Docker

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (edit only your own row).
>
> **Drift check (run first)**:
> `grep -c "not implemented: plan 004" packages/core/src/sim/index.ts packages/ether/src/server.ts`
> → each file reports `1`. If a file is missing or reports 0, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-scaffold-and-contracts.md
- **Category**: tests / direction
- **Planned at**: no git history (greenfield), 2026-11-14

## Why this matters

BirdSong devices talk to each other through real speakers and microphones.
That cannot be tested automatically, and Docker containers on one machine
have no shared air. This plan builds a stand-in for the air: something that
takes the audio every node plays, mixes it by distance, and gives every node
what its microphone would hear. It comes in two forms that share one mixing
function: an **in-process world with a virtual clock** (minutes of mesh
behaviour simulate in seconds, deterministically, for tests) and a
**real-time WebSocket service** (so 8 Docker containers can form a mesh, and
so there is a fallback demo if the real room is too noisy).

## Current state

After plan 001 the repo is an npm-workspaces TypeScript monorepo. Files you
build on (read them; do not modify them):

- `packages/core/src/types.ts`:
  ```ts
  export interface AudioPort {
    readonly sampleRate: number;
    start(): Promise<void>;
    stop(): Promise<void>;
    onInput(cb: (pcm: Float32Array) => void): void;
    play(pcm: Float32Array): Promise<void>;   // resolves when playback finished; calls are queued
    setVolume(v: number): void;                // 0..1
  }
  export interface Clock { now(): number; setTimeout(fn: () => void, ms: number): TimerId; clearTimeout(id: TimerId): void }
  export interface Modem {
    readonly sampleRate: number;
    encode(air: Uint8Array, species: number): Float32Array;
    push(pcm: Float32Array): void;
    onFrame(cb: (air: Uint8Array, meta: RxMeta) => void): void;
    busy(): boolean;
    reset(): void;
  }
  export interface RxMeta { sync: number; confidence: number; startSample: number; symbols: number[] }
  export interface ModemOptions { sampleRate: number; env: EnvName; profile: ProfileName; syncThreshold?: number }
  export type ModemFactory = (opts: ModemOptions) => Modem;
  ```
- `packages/core/src/util/clock.ts` — `createVirtualClock(startMs?)` returns a
  `VirtualClock` (`Clock` plus `advance(ms)`, which fires due timers in order).
- `packages/core/src/util/prng.ts` — `mulberry32(seed)`, `gaussian(rng)`.
- `packages/core/src/timing.ts` — `frameAirtimeMs(profile)`;
  `packages/core/src/envs.ts` — `PROFILES`.
- `packages/core/src/constants.ts` — `FRAME_AIR_LEN = 32`.
- `packages/core/src/telemetry.ts` — `ETHER_PORT = 7080`.
- `packages/core/src/sim/index.ts` — stub; you replace it.
- `packages/ether/src/server.ts`, `packages/ether/src/client.ts` — stubs; you replace them.
- The `ws` package is installed for `@birdsong/ether`
  (`import { WebSocketServer } from 'ws'`).

Source-code rules (Node runs the `.ts` files directly): relative imports end
in `.ts`; type-only imports use `import type`; no `enum`, `namespace` or
constructor parameter properties. `packages/core` must stay free of Node-only
APIs (it also runs in browsers): no `node:` imports in `packages/core/src/sim/`.

## Commands you will need

| Purpose   | Command                                                      | Expected |
|-----------|--------------------------------------------------------------|----------|
| Typecheck | `npm run typecheck -w @birdsong/core -w @birdsong/ether`     | exit 0   |
| My tests  | `npx vitest run packages/core/src/sim packages/ether`        | all pass |

## Scope

**In scope**:
- `packages/core/src/sim/index.ts`, `mix.ts`, `world.ts`, `fakeModem.ts`, `*.test.ts`
- `packages/ether/src/server.ts`, `client.ts`, `packages/ether/test/*.test.ts`

**Out of scope**:
- `packages/core/src/node/`, `modem/`, `codec/` — other executors work there.
- `package.json` files and the lockfile.
- Any Docker file (plan 007 writes those).

## Git workflow

- Commit only your paths: `git add packages/core/src/sim packages/ether && git commit -m "feat(sim): <what>" -- packages/core/src/sim packages/ether`.
- **Several executors work in this repository at the same time.** When you run
  `npm run typecheck` or `npm test`, judge only errors in `packages/core/src/sim/`
  and `packages/ether/`; errors elsewhere belong to other executors.
- If git reports `index.lock` exists, wait 5 seconds and retry. Do NOT push.

## Steps

### Step 1: The mixing function — `packages/core/src/sim/mix.ts`

```ts
export interface Position { x: number; y: number }

/** Linear gain from a speaker at `a` to a microphone at `b`. */
export function gainBetween(a: Position, b: Position, range: number): number
```
`d` = Euclidean distance. Return `0` if `d > range`, otherwise `min(1, 1 / d)`
(and `1` when `d === 0`).

```ts
/**
 * tx[j] is what speaker j plays during this block (same length for all; a
 * dead or silent speaker passes zeros). Returns rx[i] for every microphone i:
 * the gain-weighted sum of every OTHER speaker, plus noise.
 * A node never hears itself here.
 */
export function mixBlock(
  tx: readonly Float32Array[], gains: readonly (readonly number[])[], // gains[j][i]: speaker j -> mic i
  noiseRms: number, rng: () => number,
): Float32Array[]
```
Propagation delay is ignored on purpose (rooms are small compared with frame
lengths). Skip the noise loop entirely when `noiseRms === 0`.

Tests (`mix.test.ts`): gain is 1 at distance ≤ 1, 0.5 at distance 2 with
range 3, 0 beyond range; with two speakers at gain 1 the microphone of a third
node gets the exact sum; a node's own signal is absent from its own input;
with `noiseRms = 0.1` and silent speakers the output RMS is within 10% of 0.1.

**Verify**: `npx vitest run packages/core/src/sim/mix.test.ts` → all pass.

### Step 2: The fake modem — `packages/core/src/sim/fakeModem.ts`

The real modem (another plan) is slow and noisy by nature. Mesh-logic tests
need a modem that is instant, exact, and still models the two physical facts
that matter: **a frame occupies the air for its full duration**, and **two
frames that overlap at a receiver destroy each other**.

```ts
export function createFakeModem(opts: ModemOptions): Modem
```

- `encode(air, species)`: output length = `round(frameAirtimeMs(PROFILES[opts.profile]) · sampleRate / 1000)`.
  - samples 0–7: the magic `[0.5, −0.5, 0.25, −0.25, 0.5, 0.5, −0.5, −0.5]`
  - samples 8–39: `(air[i] − 127.5) / 256` for the 32 bytes
  - every remaining sample: `0.0625` (the "carrier")
  - `species` is ignored. Throw `RangeError` if `air.length !== FRAME_AIR_LEN`.
- Receiver (`push`), sample by sample with an absolute sample counter. It
  must work at any volume, so it measures the frame's scale first:
  - **Idle**: keep the last 8 samples `h[0..7]`. Let `a = h[0] / 0.5`. If
    `a ≥ 0.02` and every `h[i]` is within `1e-3 · a` of `a · magic[i]` → go to
    **Header** state, remember `a` and the start sample.
  - **Header**: read 32 samples → bytes `round((s / a) · 256 + 127.5)`, clamped to 0..255.
  - **Carrier**: for the rest of the frame every sample must be within
    `1e-3 · a` of `0.0625 · a`. On the first violation mark the frame as **collided**.
  - At the last sample of the frame: if not collided, call `onFrame(bytes, { sync: 1, confidence: 1, startSample, symbols: [] })`.
    Either way return to Idle.
  - A header sample that makes a byte invalid cannot be detected; that is fine
    (a later CRC catches it).
- `busy()`: true in Header and Carrier states.
- `reset()`: back to Idle, clear the 8-sample history.
- Limitations to document in a comment: (1) this modem needs a noise-free
  channel; with any noise every frame is dropped. (2) The sim world starts all
  playback on block boundaries, so two frames that start in the **same block**
  overlap sample for sample: the receiver then sees a valid-looking magic and
  emits a blended frame of garbage bytes instead of dropping it. That is
  harmless (the frame layer's CRC and Reed–Solomon reject it, so the node logs
  `bad crc`), but tests must not assume "overlap ⇒ no `onFrame` call" in that case.

Tests (`fakeModem.test.ts`): round trip of random bytes; random chunk sizes;
`busy()` true during the frame; two frames added together with the second
delayed by 100 samples → **neither** is emitted; two frames one after the
other → both emitted; a frame scaled by 0.4 → still emitted with the right
bytes; a frame with noise of RMS 0.01 added → not emitted.

**Verify**: `npx vitest run packages/core/src/sim/fakeModem.test.ts` → all pass.

### Step 3: The in-process world — `packages/core/src/sim/world.ts`

```ts
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
export function createSimWorld(opts: SimWorldOptions): SimWorld
```

One simulation block (`blockMs`, i.e. `B = round(blockMs · sampleRate / 1000)` samples):
1. For every port take the next `B` samples from its play queue (zeros if the
   queue is empty or the port is dead; multiply by its volume).
2. `rx = mixBlock(tx, gains, noiseRms, rng)`.
3. For every **alive** port that has an input callback and has been started, call it with `rx[i]`.
4. Resolve the `play()` promises of every port whose queued buffer was fully consumed in this block.
5. `clock.advance(blockMs)` — this fires timers.
6. **Settle**: yield one real macrotask, then await every `onSettle` hook,
   then repeat this step once more. To yield, use
   `typeof setImmediate === 'function' ? new Promise(r => setImmediate(r)) : new Promise(r => setTimeout(r, 0))`
   (the real globals, not the virtual clock; `setTimeout(0)` alone costs 1 ms
   per block in Node and makes long simulations slow). Nodes do asynchronous
   crypto work; without this step the simulation would race ahead of them.

`play()` appends to the port's queue; several queued buffers play one after
another. Recompute the gain matrix whenever a port is added. `gains[j][i]` for
dead ports is treated as 0 in both directions.

Tests (`world.test.ts`), using the fake modem at 8000 Hz:
- Two ports 1 apart: a frame played on port 0 is emitted by a fake modem fed
  from port 1's input; port 0's own input stays silent.
- Three ports in a line at x = 0, 1, 2 (range 1.2): port 2 does not hear port 0.
- `play()` resolves at virtual time = audio duration (± one block).
- A timer set on `world.clock` for 500 ms fires during `run(1000)`.
- `setAlive(1, false)`: port 1 receives no input callbacks; frames from port 1 reach nobody.
- `runUntil` returns false when the predicate never becomes true, and stops early when it does.
- Determinism: the same seed and the same actions give byte-identical input streams with `noiseRms = 0.05`.
- Speed: `run(60_000)` with 8 idle ports at 8000 Hz finishes in under 5 s of wall time.

**Verify**: `npx vitest run packages/core/src/sim/world.test.ts` → all pass.

### Step 4: Export from core

`packages/core/src/sim/index.ts`: export everything from `mix.ts`,
`fakeModem.ts` and `world.ts`. Remove the `SIM_NOT_IMPLEMENTED` constant.

**Verify**: `npm run typecheck -w @birdsong/core` → exit 0.
**Verify**: `npx vitest run packages/core/src/sim` → all pass.

### Step 5: Real-time ether service — `packages/ether/src/server.ts`

A WebSocket server that does the same mixing in real time at 48 000 Hz.

- Configuration from environment variables: `ETHER_PORT` (default 7080),
  `ETHER_RANGE` (default 1.2), `ETHER_NOISE_RMS` (default 0.002),
  `ETHER_SAMPLE_RATE` (default 48000).
- Export `startEtherServer(opts): { close(): Promise<void>; port: number }` and,
  at the bottom of the file, start it only when the file is run directly:
  `if (import.meta.url === \`file://${process.argv[1]}\`) { … }`.
- **Node connection**: `ws://host:port/node?id=<0-255>&x=<number>&y=<number>`.
  - Client → server, binary: raw little-endian Float32 samples to play. Any
    length. The server appends them to that node's play queue.
  - Server → client, binary: one Float32 block of 960 samples (20 ms) every
    tick: what that node's microphone hears.
- **Listener connection**: `ws://host:port/listen?x=<number>&y=<number>`.
  Receives the mix of **every** node regardless of `ETHER_RANGE` (gain
  `min(1, 1 / d)` with no range cut-off), so a listener in the middle hears
  the whole flock; sends nothing. This lets a dashboard play the simulated air out loud.
- **Tick loop**: `setInterval` every 10 ms; on each run compute how many 20 ms
  blocks are due from the wall clock (`performance.now()`), and process that
  many (cap at 10 per run to avoid a spiral). Per block: take 960 samples from
  each node's queue (zeros if short), `mixBlock`, send.
- A node that disconnects is removed. Reconnecting with the same id replaces the old connection.
- On start, log `ether listening on <port>`. Log one line per
  connect/disconnect. No other logging in the hot path.

### Step 6: Ether client port — `packages/ether/src/client.ts`

```ts
export function createEtherPort(opts: { url: string; id: number; x: number; y: number; sampleRate?: number }): AudioPort
```

- Uses the **global** `WebSocket` (available in Node ≥ 22 and in browsers); do
  not import `ws` here. Set `binaryType = 'arraybuffer'`.
- `start()`: connect to `${url}/node?id=…&x=…&y=…`. If the connection fails
  (for example the ether is not listening yet), retry every 1 s; `start()`
  resolves on the first successful open and never rejects for connection
  errors. If the connection drops later, reconnect every 1 s, forever.
- Incoming binary message → `Float32Array` → the `onInput` callback.
- `play(pcm)`: multiply by the volume, send as one binary message (copy the
  samples into a fresh `ArrayBuffer`), and resolve after
  `pcm.length / sampleRate` seconds measured from when the *previous* queued
  play finishes (so queued calls line up back to back).
- `stop()`: close and stop reconnecting.

Test (`packages/ether/test/ether.test.ts`): start a server on port 0 (random
free port) with `noiseRms: 0`; connect two `createEtherPort`s at distance 1 and
a third at distance 5. Play a 0.5 s 1 kHz sine at amplitude 0.5 on port A.
Assert within 3 s: port B received audio with RMS between 0.25 and 0.45 over
some 20 ms block; port C received only zeros; `play()` resolved between 0.4 s
and 1.2 s after the call. Close everything in `afterAll`.

**Verify**: `npx vitest run packages/ether` → all pass.
**Verify**: `npm run typecheck -w @birdsong/ether` → exit 0.
**Verify**: `timeout 3 node packages/ether/src/server.ts; echo "exit=$?"` → prints a
"listening on 7080" line and `exit=124` (killed by the timeout, i.e. it ran).

## Test plan

`mix.test.ts`, `fakeModem.test.ts`, `world.test.ts` in `packages/core/src/sim/`;
`ether.test.ts` in `packages/ether/test/`. About 25 cases in total.

## Done criteria

- [ ] `npx vitest run packages/core/src/sim packages/ether` exits 0
- [ ] `npm run typecheck -w @birdsong/core -w @birdsong/ether` exits 0
- [ ] `grep -rn "not implemented" packages/core/src/sim packages/ether/src | wc -l` → `0`
- [ ] `grep -rn "node:" packages/core/src/sim | wc -l` → `0`
- [ ] `git status --porcelain -- package.json package-lock.json packages/core/src/constants.ts packages/core/src/types.ts packages/core/src/envs.ts packages/core/src/timing.ts packages/core/src/symbols.ts packages/core/src/telemetry.ts packages/core/src/util` prints nothing (you changed no shared file)
- [ ] `git log -1 --name-only` lists only files under `packages/core/src/sim/` and `packages/ether/` (and `plans/README.md` if you committed it)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The global `WebSocket` is not defined when running under Vitest or plain
  Node. Then import `WebSocket` from `ws` **only inside a
  `typeof WebSocket === 'undefined'` fallback using dynamic `import('ws')`**,
  and note it in `plans/README.md`. If that also fails, STOP.
- The world's determinism test fails and you cannot find a source of
  non-determinism other than WebCrypto timing (there is no crypto in this
  plan, so it should not happen).

## Maintenance notes

- `mixBlock` ignores propagation delay and echo. For acoustic realism, tests
  that use the real modem add reverb themselves with `channelSim.ts` (plan 003).
- The settle step (Step 3.6) is what makes node simulations deterministic.
  Plan 005 registers `node.settled()` as a settle hook for every node.
- The fake modem deliberately drops noisy frames. Use it only with `noiseRms: 0`.
