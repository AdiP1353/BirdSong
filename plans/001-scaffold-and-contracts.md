# Plan 001: The monorepo exists, installs, typechecks, and every shared contract is in code

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `ls -A` in the repo root must print only `plans`
> and `.claude` (the Claude Code settings folder; leave it alone).
> If anything else exists, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (every other plan builds on these files)
- **Depends on**: none
- **Category**: dx
- **Planned at**: no git history (greenfield folder), 2026-11-14

## Why this matters

BirdSong is an acoustic mesh network: devices pass encrypted text messages to
each other as synthetic birdsong played through speakers and heard by
microphones. Nine other plans build its parts **in parallel**. That only works
if (a) all dependencies are already installed, so nobody edits `package.json`
or the lockfile at the same time, and (b) every shared type, constant and
function signature already exists in code, so parallel work compiles against
the same contract. This plan creates exactly that and nothing else.

## Current state

- Repo root: `/home/aprakash/Documents/projects/Durhack/BirdSong`. It contains
  only `plans/`. It is **not** a git repository yet.
- Toolchain on this machine (verified): Node `v26.13.1`, npm `12.2.2`,
  git `2.56.1`, Docker `29.9.3`. **pnpm, corepack and tsx are NOT installed.**
  Use **npm workspaces**. Do not install global tools.
- TypeScript runs **without a build step**:
  - Node (≥ 23.6) strips types natively: `node file.ts` works.
  - Vite and Vitest transpile TypeScript themselves.
  - This imposes three rules on ALL source code in this repo. State them in
    the root `README.md` (Step 9):
    1. Relative imports include the `.ts` extension: `import { x } from './foo.ts'`.
    2. Type-only imports use `import type { ... }`.
    3. No `enum`, no `namespace`, no constructor parameter properties
       (`constructor(private x: number)`), because Node cannot strip them.
    4. When passing a typed array to WebCrypto or Web Audio and the compiler
       complains about `ArrayBufferLike`, pass `x.slice()` (a fresh copy);
       never change a shared signature to work around it.

## Commands you will need

| Purpose   | Command                 | Expected on success        |
|-----------|-------------------------|----------------------------|
| Install   | `npm install`           | exit 0                     |
| Typecheck | `npm run typecheck`     | exit 0, no errors          |
| Tests     | `npm test`              | all pass                   |
| One file  | `npx vitest run <path>` | all pass                   |

## Scope

**In scope** (create all of these):
- `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.base.json`,
  `vitest.config.ts`, `vitest.e2e.config.ts`, `README.md`
- `.github/workflows/ci.yml`
- `packages/core/**`, and skeletons for `packages/ether`, `packages/node-runtime`,
  `packages/web`, `packages/dashboard`

**Out of scope**:
- Any real implementation of codec, modem, node engine, song, ambient, sim.
  You write **stubs that throw**. Other plans replace them.
- Docker files, GitHub Pages or image workflows, docs beyond the short README.

## Git workflow

- Step 1 runs `git init -b main`.
- One commit at the end: `chore: scaffold monorepo and shared contracts`.
- Do NOT add a remote, push, or open a PR.

## Steps

### Step 1: Initialise git and root files

Run `git init -b main`.

Create `.gitignore`:

```
node_modules/
dist/
.vite/
*.log
.DS_Store
.claude/settings.local.json
```

Create root `package.json`:

```json
{
  "name": "birdsong",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "workspaces": ["packages/*"],
  "scripts": {
    "typecheck": "npm run typecheck --workspaces",
    "test": "vitest run",
    "test:e2e": "vitest run --config vitest.e2e.config.ts"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true
  }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.e2e.test.ts'],
    testTimeout: 60_000,
  },
});
```

Create `vitest.e2e.config.ts`: the same, but `include: ['packages/*/test/**/*.e2e.test.ts']`,
`exclude: ['**/node_modules/**']`, `testTimeout: 300_000`, and add
`passWithNoTests: true` inside `test`.

**Verify**: `git status --short | head -5` → lists the new files; exit 0.

### Step 2: Create the five package manifests

For each package create `packages/<dir>/package.json` and `packages/<dir>/tsconfig.json`.
Every manifest has the same base fields as core below (`"version": "0.1.0"`,
`"private": true`, `"type": "module"`) plus what is listed for it.

`packages/core/package.json`:

```json
{
  "name": "@birdsong/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p ." }
}
```

`packages/ether/package.json`: same shape, name `@birdsong/ether`, but with
`"exports": { ".": "./src/client.ts" }` (the importable part of this package
is the client; `src/index.ts` never exists here), plus
`"dependencies": { "@birdsong/core": "*" }` and script
`"start": "node src/server.ts"`.

`packages/node-runtime/package.json`: name `@birdsong/node-runtime`,
dependencies `@birdsong/core` and `@birdsong/ether` (both `"*"`), script
`"start": "node src/main.ts"`, and `"bin": { "birdsong": "./src/cli.ts" }`.

`packages/web/package.json`: name `@birdsong/web`, dependency `@birdsong/core`,
scripts `"dev": "vite"`, `"build": "vite build"`, `"typecheck": "tsc --noEmit -p ."`.
No `exports` field.

`packages/dashboard/package.json`: name `@birdsong/dashboard`, dependency
`@birdsong/core`, scripts `"dev": "vite"`, `"build": "vite build"`,
`"start": "node src/server/hub.ts"`, `"typecheck": "tsc --noEmit -p ."`.
No `exports` field.

**Every** package's `scripts` must include `"typecheck": "tsc --noEmit -p ."`
(the root `typecheck` script runs it in each workspace).

Every `tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

For `web` and `dashboard` add inside a `compilerOptions` object:
`"jsx": "react-jsx", "jsxImportSource": "preact"`, and include `"vite.config.ts"`.

**Verify**: `ls packages/*/package.json | wc -l` → `5`.

### Step 3: Install every dependency the whole project needs

Other plans must never run `npm install <pkg>`. Install everything now. Run
these from the repo root, one at a time:

```
npm install -D typescript@~5.8.3 vitest @types/node
npm install -w @birdsong/core fft.js unishox2.siara.cc
npm install -w @birdsong/ether ws
npm install -w @birdsong/ether -D @types/ws
npm install -w @birdsong/node-runtime ws
npm install -w @birdsong/node-runtime -D @types/ws
npm install -w @birdsong/web preact
npm install -w @birdsong/web -D vite @preact/preset-vite vite-plugin-pwa
npm install -w @birdsong/dashboard preact d3-force qrcode ws
npm install -w @birdsong/dashboard -D vite @preact/preset-vite @types/d3-force @types/qrcode @types/ws
```

If `vite-plugin-pwa` fails with a peer-dependency error (`ERESOLVE`), skip that
one package (do not use `--force`) and write the line
`vite-plugin-pwa: NOT INSTALLED (peer conflict)` into the "Notes from executors"
section of `plans/README.md`. That is not a STOP condition.

**Verify**: `npm ls --workspaces --depth=0 2>&1 | grep -c "UNMET"` → `0`.
**Verify**: `npx tsc --version` → prints `Version 5.8.x`. TypeScript is pinned
to 5.8 on purpose: npm's `latest` is TypeScript 7 (a different compiler), and
TypeScript 5.9+ changed the DOM `BufferSource` typings so that plain
`Uint8Array` values no longer type-check as WebCrypto inputs. Do not upgrade it.

### Step 4: Write the core contract files (verbatim)

Create these files exactly as given.

`packages/core/src/constants.ts`:

```ts
/** Protocol constants. Changing any of these changes the on-air format. */
export const PROTOCOL_VERSION = 1;

/** Fountain block size = droplet payload size, in bytes. */
export const BLOCK_SIZE = 16;
/** Maximum number of source blocks per message (4-bit field). */
export const MAX_K = 15;
/** Droplet seeds are 0..MAX_SEED. Seed 255 is reserved. */
export const MAX_SEED = 254;

export const HEADER_LEN = 6;
export const CRC_LEN = 2;
/** header(6) + payload(16) + crc(2) */
export const FRAME_BODY_LEN = HEADER_LEN + BLOCK_SIZE + CRC_LEN; // 24
/** Reed-Solomon parity bytes appended to the frame body. */
export const RS_PARITY_LEN = 8;
/** Bytes actually modulated into sound for one frame. */
export const FRAME_AIR_LEN = FRAME_BODY_LEN + RS_PARITY_LEN; // 32

export const HOP_LIMIT = 8;
export const MSG_TTL_MS = 300_000;

export const MAX_TEXT_CHARS = 140;
export const MAX_ALIAS_CHARS = 8;
/** Envelope = [len 1][flags 1][nonce 4][ciphertext n][tag 8] */
export const ENVELOPE_HEADER_LEN = 6;
export const GCM_TAG_LEN = 8;
export const NONCE_RANDOM_LEN = 4;
export const MAX_ENVELOPE_LEN = MAX_K * BLOCK_SIZE; // 240
export const PBKDF2_SALT = 'birdsong/v1';
export const PBKDF2_ITERATIONS = 100_000;

export const SPECIES_COUNT = 4;
/** Every data chirp sweeps this many semitones above its base pitch. */
export const SWEEP_SEMITONES = 3;
export const DEFAULT_SAMPLE_RATE = 48_000;
```

`packages/core/src/envs.ts`:

```ts
import { SWEEP_SEMITONES } from './constants.ts';

export type EnvName = 'quiet' | 'jungle' | 'coast' | 'city';
export type ProfileName = 'stealth' | 'fast';

export interface Profile {
  name: ProfileName;
  syllableMs: number;
  gapMs: number;
  /** Number of chirp shapes in use: 2 = up/down, 4 = up/down/hook/dip. */
  shapes: 2 | 4;
  /** 3 bits of pitch + log2(shapes) bits of shape. */
  bitsPerSymbol: 4 | 5;
  /** Insert a pause after every `phraseLen` syllables. 0 = never. */
  phraseLen: number;
  phrasePauseMs: number;
}

export const PROFILES: Record<ProfileName, Profile> = {
  stealth: { name: 'stealth', syllableMs: 90, gapMs: 30, shapes: 2, bitsPerSymbol: 4, phraseLen: 8, phrasePauseMs: 120 },
  fast: { name: 'fast', syllableMs: 40, gapMs: 10, shapes: 4, bitsPerSymbol: 5, phraseLen: 0, phrasePauseMs: 0 },
};

export interface EnvProfile {
  name: EnvName;
  label: string;
  /** Musical key, for display. */
  key: string;
  /** The 8 base pitches as MIDI note numbers, ascending. */
  midi: readonly number[];
  defaultProfile: ProfileName;
  theme: { bg: string; fg: string; accent: string };
}

export const ENVS: Record<EnvName, EnvProfile> = {
  quiet: {
    name: 'quiet', label: 'Quiet room', key: 'C major',
    midi: [96, 98, 100, 101, 103, 105, 107, 108],
    defaultProfile: 'fast',
    theme: { bg: '#14161a', fg: '#e8e8e8', accent: '#9ad1ff' },
  },
  jungle: {
    name: 'jungle', label: 'Jungle', key: 'A major pentatonic',
    midi: [97, 100, 102, 105, 107, 109, 112, 114],
    defaultProfile: 'stealth',
    theme: { bg: '#0d1f14', fg: '#e3f5e1', accent: '#7be07b' },
  },
  coast: {
    name: 'coast', label: 'Coast', key: 'D mixolydian',
    midi: [86, 88, 90, 91, 93, 95, 96, 98],
    defaultProfile: 'stealth',
    theme: { bg: '#0c1c2b', fg: '#e6f2fb', accent: '#5cc8e8' },
  },
  city: {
    name: 'city', label: 'City', key: 'E minor pentatonic',
    midi: [95, 98, 100, 103, 105, 107, 110, 112],
    defaultProfile: 'fast',
    theme: { bg: '#1c1a22', fg: '#eeeaf5', accent: '#f0b35c' },
  },
};

export const ENV_NAMES: readonly EnvName[] = ['quiet', 'jungle', 'coast', 'city'];
export const PROFILE_NAMES: readonly ProfileName[] = ['stealth', 'fast'];

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** The 8 base pitches of an environment in Hz, ascending. */
export function envPitchesHz(env: EnvName): number[] {
  return ENVS[env].midi.map(midiToHz);
}

/** Ratio between the top and bottom of one data chirp. */
export const SWEEP_RATIO = 2 ** (SWEEP_SEMITONES / 12);

/** Lowest and highest frequency any signal of this environment uses. */
export function envSignalRange(env: EnvName): { lowHz: number; highHz: number } {
  const p = envPitchesHz(env);
  return { lowHz: p[0]!, highHz: p[p.length - 1]! * SWEEP_RATIO };
}

/** Receiver pass band: the signal range with a 10% margin on both sides. */
export function envBand(env: EnvName): { lowHz: number; highHz: number } {
  const r = envSignalRange(env);
  return { lowHz: r.lowHz * 0.9, highHz: r.highHz * 1.1 };
}
```

`packages/core/src/timing.ts`:

```ts
import { FRAME_AIR_LEN } from './constants.ts';
import type { Profile } from './envs.ts';

/**
 * Layout of one frame on air, in milliseconds from the start of the frame:
 *
 *   [intro: 3 notes of 40 ms, 20 ms apart]   0 .. 160   (decoration, never decoded)
 *   [gap 60]
 *   [sync: up-sweep 60, gap 20, down-sweep 60]  220 .. 360   (what the receiver detects)
 *   [gap 40]
 *   [data symbols]  400 ..
 *   [tail 20]
 */
export const INTRO_NOTES = 3;
export const INTRO_NOTE_MS = 40;
export const INTRO_GAP_MS = 20;
export const INTRO_MS = INTRO_NOTES * INTRO_NOTE_MS + (INTRO_NOTES - 1) * INTRO_GAP_MS; // 160
export const PRE_SYNC_GAP_MS = 60;
export const SYNC_START_MS = INTRO_MS + PRE_SYNC_GAP_MS; // 220
export const SYNC_SWEEP_MS = 60;
export const SYNC_GAP_MS = 20;
export const SYNC_MS = 2 * SYNC_SWEEP_MS + SYNC_GAP_MS; // 140
export const POST_SYNC_GAP_MS = 40;
export const DATA_START_MS = SYNC_START_MS + SYNC_MS + POST_SYNC_GAP_MS; // 400
export const TAIL_MS = 20;

export function symbolsPerFrame(p: Profile): number {
  return Math.ceil((FRAME_AIR_LEN * 8) / p.bitsPerSymbol);
}

/** Start time of data symbol `i` (0-based) from the start of the frame. */
export function symbolStartMs(i: number, p: Profile): number {
  const pauses = p.phraseLen > 0 ? Math.floor(i / p.phraseLen) : 0;
  return DATA_START_MS + i * (p.syllableMs + p.gapMs) + pauses * p.phrasePauseMs;
}

/** Total duration of one frame on air. stealth = 8910 ms, fast = 3010 ms. */
export function frameAirtimeMs(p: Profile): number {
  return symbolStartMs(symbolsPerFrame(p) - 1, p) + p.syllableMs + TAIL_MS;
}
```

`packages/core/src/symbols.ts`:

```ts
import { SWEEP_RATIO } from './envs.ts';

export const SHAPE_UP = 0;
export const SHAPE_DOWN = 1;
export const SHAPE_HOOK = 2; // up then down
export const SHAPE_DIP = 3; // down then up

/** A symbol is an integer: low 3 bits = pitch index (0..7), upper bits = shape. */
export function symbolPitchIndex(sym: number): number {
  return sym & 7;
}
export function symbolShape(sym: number): number {
  return sym >> 3;
}
export function makeSymbol(pitchIndex: number, shape: number): number {
  return (shape << 3) | (pitchIndex & 7);
}

/**
 * Frequency of a chirp at its start, its midpoint and its end. The frequency
 * moves linearly start -> mid over the first half and mid -> end over the
 * second half. Synth and receiver templates must both use this function.
 */
export function shapeFreqs(pitchHz: number, shape: number): { start: number; mid: number; end: number } {
  const lo = pitchHz;
  const hi = pitchHz * SWEEP_RATIO;
  const half = (lo + hi) / 2;
  switch (shape) {
    case SHAPE_UP: return { start: lo, mid: half, end: hi };
    case SHAPE_DOWN: return { start: hi, mid: half, end: lo };
    case SHAPE_HOOK: return { start: lo, mid: hi, end: lo };
    case SHAPE_DIP: return { start: hi, mid: lo, end: hi };
    default: throw new Error(`unknown shape ${shape}`);
  }
}

/** Pack bytes into symbols, most significant bit first, zero-padded at the end. */
export function bytesToSymbols(bytes: Uint8Array, bitsPerSymbol: number): number[] {
  const out: number[] = [];
  const totalBits = bytes.length * 8;
  for (let bit = 0; bit < totalBits; bit += bitsPerSymbol) {
    let sym = 0;
    for (let j = 0; j < bitsPerSymbol; j++) {
      const idx = bit + j;
      const b = idx < totalBits ? (bytes[idx >> 3]! >> (7 - (idx & 7))) & 1 : 0;
      sym = (sym << 1) | b;
    }
    out.push(sym);
  }
  return out;
}

/** Inverse of bytesToSymbols. Extra padding bits are discarded. */
export function symbolsToBytes(symbols: readonly number[], bitsPerSymbol: number, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  const totalBits = byteLen * 8;
  for (let i = 0; i < symbols.length; i++) {
    for (let j = 0; j < bitsPerSymbol; j++) {
      const idx = i * bitsPerSymbol + j;
      if (idx >= totalBits) return out;
      const b = (symbols[i]! >> (bitsPerSymbol - 1 - j)) & 1;
      if (b) out[idx >> 3] |= 1 << (7 - (idx & 7));
    }
  }
  return out;
}
```

`packages/core/src/types.ts`:

```ts
import type { EnvName, ProfileName } from './envs.ts';
import type { TelemetryEvent } from './telemetry.ts';

/** A speaker + microphone pair. Samples are mono Float32 in -1..1. */
export interface AudioPort {
  readonly sampleRate: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Register the single microphone callback. Chunk sizes are arbitrary. */
  onInput(cb: (pcm: Float32Array) => void): void;
  /** Play samples. Resolves when playback has finished. Calls are queued. */
  play(pcm: Float32Array): Promise<void>;
  /** Output gain, 0..1. */
  setVolume(v: number): void;
}

export type TimerId = number;
export interface Clock {
  /** Milliseconds. Only differences are meaningful. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
}

/** One droplet with its routing header. `payload` is BLOCK_SIZE bytes. */
export interface Frame {
  netTag: number; // 0..255, identifies the channel
  msgId: number; // 0..65535
  k: number; // 1..15 source blocks. 0 is reserved for control frames.
  hop: number; // 0..15, hops from the originator to the sender of this frame
  seed: number; // 0..254
  sender: number; // 0..255 node id
  payload: Uint8Array;
}

export interface RxMeta {
  /** Normalised sync correlation, 0..1. */
  sync: number;
  /** Mean per-symbol decision margin, 0..1. */
  confidence: number;
  /** Absolute input sample index where the sync began. */
  startSample: number;
  symbols: number[];
}

export interface ModemOptions {
  sampleRate: number;
  env: EnvName;
  profile: ProfileName;
  /** Minimum sync correlation to accept. Default 0.25. */
  syncThreshold?: number;
}

/** Turns FRAME_AIR_LEN bytes into sound and sound back into bytes. */
export interface Modem {
  readonly sampleRate: number;
  /** `air.length` must equal FRAME_AIR_LEN. Returns one whole frame of audio. */
  encode(air: Uint8Array, species: number): Float32Array;
  /** Feed microphone samples. May call the onFrame callback synchronously. */
  push(pcm: Float32Array): void;
  /** Called once per detected frame with FRAME_AIR_LEN demodulated bytes. The bytes may contain errors. */
  onFrame(cb: (air: Uint8Array, meta: RxMeta) => void): void;
  /** True while a frame is arriving or the channel recently had in-band energy. Used for listen-before-sing. */
  busy(): boolean;
  /** Drop all buffered input and pending detections. */
  reset(): void;
}
export type ModemFactory = (opts: ModemOptions) => Modem;

export type NodeKind = 'container' | 'browser' | 'sim';

export interface NodeConfig {
  env: EnvName;
  profile: ProfileName;
  volume: number; // 0..1
  /** A muted node neither sings nor listens. Used as the demo "kill switch". */
  muted: boolean;
  /** If not null, frames from sender ids outside this list are ignored. */
  neighbors: number[] | null;
  /** Whether the runtime should play the ambient bed. The engine only stores it. */
  camouflage: boolean;
}

export interface MessageStatus {
  msgId: number;
  k: number;
  rank: number;
  decoded: boolean;
  /** This node's distance from the originator in hops. 0 = I wrote it. */
  hop: number;
  firstSeenAt: number;
  heard: number; // valid droplets received
  sang: number; // droplets transmitted
}

export interface InboxMessage {
  msgId: number;
  text: string;
  alias: string;
  hops: number;
  receivedAt: number;
  mine: boolean;
}

export interface NodeState {
  id: number;
  species: number;
  kind: NodeKind;
  config: NodeConfig;
  messages: MessageStatus[];
  inbox: InboxMessage[];
}

export interface BirdNodeOptions {
  id: number; // 0..255
  kind: NodeKind;
  passphrase: string;
  alias?: string;
  config: NodeConfig;
  port: AudioPort;
  clock: Clock;
  /** Uniform random in [0, 1). Injected so simulations are reproducible. */
  rng: () => number;
  modemFactory: ModemFactory;
}

export interface BirdNode {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Encrypt, encode and start gossiping a message. Resolves with its msgId. */
  send(text: string): Promise<number>;
  configure(patch: Partial<NodeConfig>): Promise<void>;
  state(): NodeState;
  onEvent(cb: (e: TelemetryEvent) => void): void;
  /** Resolves when no internal async work (crypto, decode) is pending. */
  settled(): Promise<void>;
}

export const DEFAULT_NODE_CONFIG: NodeConfig = {
  env: 'quiet',
  profile: 'fast',
  volume: 0.8,
  muted: false,
  neighbors: null,
  camouflage: false,
};
```

`packages/core/src/telemetry.ts`:

```ts
import type { NodeConfig, NodeKind } from './types.ts';

/**
 * Observer channel. These events travel over the LAN to the dashboard for
 * visualisation only. Message data never travels this way.
 */
export type TelemetryEvent =
  | { type: 'hello'; node: number; species: number; kind: NodeKind; config: NodeConfig; t: number }
  | { type: 'config'; node: number; config: NodeConfig; t: number }
  | { type: 'heard'; node: number; from: number; msgId: number; seed: number; hop: number; k: number; sync: number; t: number }
  | { type: 'bad'; node: number; reason: 'crc' | 'netTag' | 'neighbor' | 'auth'; t: number }
  | { type: 'rank'; node: number; msgId: number; rank: number; k: number; t: number }
  | { type: 'decoded'; node: number; msgId: number; hops: number; text: string; alias: string; t: number }
  | { type: 'sang'; node: number; msgId: number; seed: number; hop: number; k: number; airHex: string; durationMs: number; t: number }
  | { type: 'expired'; node: number; msgId: number; t: number };

export type Command =
  | { type: 'configure'; node: number | 'all'; patch: Partial<NodeConfig> }
  | { type: 'send'; node: number; text: string };

export interface NodeSnapshot {
  node: number;
  species: number;
  kind: NodeKind;
  config: NodeConfig;
  online: boolean;
  lastSeenAt: number;
}

/** Messages from the dashboard hub to a dashboard browser tab. */
export type HubToUi =
  | { type: 'snapshot'; nodes: NodeSnapshot[]; recent: TelemetryEvent[]; join: { pwaUrl: string; passphrase: string } }
  | { type: 'event'; event: TelemetryEvent }
  | { type: 'nodeOffline'; node: number };

/** Default ports. */
export const HUB_PORT = 7070;
export const ETHER_PORT = 7080;
export const NODE_UI_PORT = 8080;
```

**Verify**: `ls packages/core/src/*.ts | wc -l` → `6`.

### Step 5: Write the utilities (you write the bodies; signatures are fixed)

Create these five files in `packages/core/src/util/`. Write a matching
`*.test.ts` next to each.

1. `prng.ts`
   - `export function mulberry32(seed: number): () => number` — the standard
     mulberry32 generator; returns a function giving uniform floats in [0, 1).
   - `export function gaussian(rng: () => number): number` — standard normal
     via Box–Muller.
   - Tests: same seed → identical first 5 values; 10 000 draws have mean within
     0.02 of 0.5; `gaussian` has variance within 0.1 of 1 over 20 000 draws.

2. `clock.ts`
   - `export function createRealClock(): Clock` — uses `performance.now()` and
     the global `setTimeout`/`clearTimeout`. Keep a `Map<number, handle>` so
     `TimerId` is always a plain number.
   - `export interface VirtualClock extends Clock { advance(ms: number): void }`
   - `export function createVirtualClock(startMs?: number): VirtualClock` —
     `now()` starts at `startMs ?? 0`. `advance(ms)` fires every timer whose
     due time is ≤ `now + ms`, **in due-time order** (ties in creation order),
     setting `now()` to each timer's due time before calling it, and including
     timers that are created during the advance and fall inside the window.
     At the end `now()` equals the old value + `ms`.
   - Import `Clock` with `import type { Clock, TimerId } from '../types.ts'`.
   - Tests: ordering; a timer that schedules another timer inside the window
     fires both; `clearTimeout` prevents firing; `now()` inside a callback
     equals that timer's due time.

3. `wav.ts`
   - `export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array`
     — 16-bit PCM, mono, little-endian, standard 44-byte RIFF header; clamp
     samples to −1..1.
   - `export function decodeWav(bytes: Uint8Array): { pcm: Float32Array; sampleRate: number }`
     — accepts 16-bit PCM and 32-bit float; if there are several channels,
     average them to mono; find the `fmt ` and `data` chunks by scanning chunk
     headers (do not assume a 44-byte header); throw `Error('unsupported wav')`
     on anything else.
   - Tests: round trip of a 1000-sample sine keeps every sample within 1e-4
     of the original (16-bit quantisation); header bytes 0–3 are `RIFF`.

4. `hex.ts`
   - `export function toHex(b: Uint8Array): string` (lower case, no separators)
   - `export function fromHex(s: string): Uint8Array`
   - Test: round trip.

5. `score.ts`
   - ```ts
     export interface ScoreNote {
       startMs: number; durMs: number; pitchIndex: number; shape: number;
       midi: number; hzStart: number; hzMid: number; hzEnd: number;
     }
     export function frameNotes(air: Uint8Array, env: EnvName, profile: ProfileName): ScoreNote[]
     ```
   - For each data symbol `i` of the frame (use `bytesToSymbols(air, PROFILES[profile].bitsPerSymbol)`):
     `startMs = symbolStartMs(i, p)`, `durMs = p.syllableMs`,
     `pitchIndex = symbolPitchIndex(sym)`, `shape = symbolShape(sym)`,
     `midi = ENVS[env].midi[pitchIndex]`, and the three frequencies from
     `shapeFreqs(envPitchesHz(env)[pitchIndex], shape)`.
   - Test: a 32-byte input gives 64 notes for `stealth` and 52 for `fast`;
     first note `startMs === 400`.

Also write `packages/core/src/timing.test.ts` asserting
`frameAirtimeMs(PROFILES.stealth) === 8910`, `frameAirtimeMs(PROFILES.fast) === 3010`,
`symbolsPerFrame` is 64 and 52; `packages/core/src/symbols.test.ts` asserting
that `symbolsToBytes(bytesToSymbols(x, b), b, 32)` equals `x` for 50 random
32-byte arrays for both `b = 4` and `b = 5`; and `packages/core/src/envs.test.ts`
asserting that for every environment `envBand(env).highHz < 8000`, the pitch
list has exactly 8 strictly ascending values, and `midiToHz(69) === 440`.

**Verify**: `npx vitest run packages/core` → all pass, at least 15 tests.

### Step 6: Write the stubs that other plans will replace (verbatim)

(No type shim is needed for `fft.js`: version 4.0.4 ships its own
`lib/fft.d.ts`. `import FFT from 'fft.js'` works with this tsconfig.)

`packages/core/src/unishox.d.ts` (the compression package ships no types):

```ts
declare module 'unishox2.siara.cc' {
  const pkg: {
    unishox2_compress_simple(input: string, length: number, out: Uint8Array): number;
    unishox2_decompress_simple(input: Uint8Array, length: number): string;
  };
  export default pkg;
}
```

Any core file that imports `unishox2.siara.cc` must start with
`/// <reference path="../unishox.d.ts" />` (adjust the relative path), so that
other packages, whose `tsc` follows imports into core, see the declaration too.

`packages/core/src/codec/index.ts` (replaced by plan 002):

```ts
import type { Frame } from '../types.ts';

function todo(): never {
  throw new Error('not implemented: plan 002');
}

export interface Channel {
  key: CryptoKey;
  netTag: number;
}
export interface FountainDecoder {
  readonly k: number;
  readonly rank: number;
  readonly done: boolean;
  /** Returns true if the droplet increased the rank. */
  add(seed: number, payload: Uint8Array): boolean;
  /** The reassembled envelope with padding removed, or null if not done or malformed. */
  envelope(): Uint8Array | null;
}

export function deriveChannel(_passphrase: string): Promise<Channel> { return todo(); }
export function sealMessage(_ch: Channel, _text: string, _alias: string, _nonce4?: Uint8Array): Promise<Uint8Array> { return todo(); }
export function openMessage(_ch: Channel, _envelope: Uint8Array): Promise<{ text: string; alias: string } | null> { return todo(); }
export function msgIdOf(_envelope: Uint8Array): Promise<number> { return todo(); }
export function splitBlocks(_envelope: Uint8Array): Uint8Array[] { return todo(); }
export function makeDroplet(_blocks: readonly Uint8Array[], _seed: number): Uint8Array { return todo(); }
export function createFountainDecoder(_k: number): FountainDecoder { return todo(); }
export function encodeAirFrame(_frame: Frame): Uint8Array { return todo(); }
export function decodeAirFrame(_air: Uint8Array): { frame: Frame; corrected: number } | null { return todo(); }
```

`packages/core/src/modem/index.ts` (replaced by plan 003):

```ts
import type { Modem, ModemOptions } from '../types.ts';

export function createModem(_opts: ModemOptions): Modem {
  throw new Error('not implemented: plan 003');
}
```

`packages/core/src/sim/index.ts` (replaced by plan 004):

```ts
export const SIM_NOT_IMPLEMENTED = 'not implemented: plan 004';
```

`packages/core/src/node/index.ts` (replaced by plan 005):

```ts
import type { BirdNode, BirdNodeOptions } from '../types.ts';

export function createBirdNode(_opts: BirdNodeOptions): BirdNode {
  throw new Error('not implemented: plan 005');
}
```

`packages/core/src/song/index.ts` (replaced by plan 006):

```ts
import type { EnvName, ProfileName } from '../envs.ts';

export interface SongOptions {
  passphrase: string;
  env: EnvName;
  profile: ProfileName;
  sampleRate: number;
}
export interface DecodedSongMessage { msgId: number; text: string; alias: string }

export function renderMessageSong(_opts: SongOptions & { text: string; alias: string; species: number; sender: number }): Promise<Float32Array> {
  throw new Error('not implemented: plan 006');
}
export function decodeSong(_pcm: Float32Array, _opts: SongOptions): Promise<DecodedSongMessage[]> {
  throw new Error('not implemented: plan 006');
}
```

`packages/core/src/ambient/index.ts` (replaced by plan 006):

```ts
import type { EnvName } from '../envs.ts';

/** Recommended ambient playback gain relative to the data signal. Final values; plan 006 keeps them. */
export const AMBIENT_LEVEL: Record<EnvName, number> = { quiet: 0, jungle: 0.5, coast: 0.7, city: 0.6 };

/** A loopable ambient bed whose energy lies outside the environment's signal band. */
export function renderAmbient(_env: EnvName, _seconds: number, _sampleRate: number, _seed: number): Float32Array {
  throw new Error('not implemented: plan 006');
}
```

`packages/core/src/index.ts`:

```ts
export * from './constants.ts';
export * from './envs.ts';
export * from './timing.ts';
export * from './symbols.ts';
export * from './types.ts';
export * from './telemetry.ts';
export * from './util/prng.ts';
export * from './util/clock.ts';
export * from './util/wav.ts';
export * from './util/hex.ts';
export * from './util/score.ts';
export * from './codec/index.ts';
export * from './modem/index.ts';
export * from './sim/index.ts';
export * from './node/index.ts';
export * from './song/index.ts';
export * from './ambient/index.ts';
```

**Verify**: `npm run typecheck -w @birdsong/core` → exit 0.

### Step 7: Write the four skeleton packages

- `packages/ether/src/server.ts`: one line, `console.log('ether: not implemented: plan 004');`
- `packages/ether/src/client.ts`: `export const ETHER_CLIENT_STUB = 'not implemented: plan 004';`
- `packages/node-runtime/src/main.ts`:
  ```ts
  import { FRAME_AIR_LEN, PROFILES, frameAirtimeMs } from '@birdsong/core';
  console.log(`birdsong node-runtime skeleton: frame=${FRAME_AIR_LEN}B fast=${frameAirtimeMs(PROFILES.fast)}ms`);
  ```
- `packages/node-runtime/src/cli.ts`: first line `#!/usr/bin/env node`, then
  `console.log('birdsong cli: not implemented: plan 007');`
- `packages/web/index.html`: minimal HTML5 page with `<div id="app"></div>` and
  `<script type="module" src="/src/main.tsx"></script>`, viewport meta tag,
  `<title>BirdSong</title>`.
- `packages/web/src/main.tsx`:
  ```tsx
  import { render } from 'preact';
  import { ENV_NAMES } from '@birdsong/core';
  render(<p>BirdSong web skeleton. Environments: {ENV_NAMES.join(', ')}</p>, document.getElementById('app')!);
  ```
- `packages/web/vite.config.ts`:
  ```ts
  import { defineConfig } from 'vite';
  import preact from '@preact/preset-vite';
  export default defineConfig({ base: './', plugins: [preact()] });
  ```
- `packages/dashboard/`: the same three files as `web` (title `BirdSong Dashboard`,
  text `BirdSong dashboard skeleton`), plus `packages/dashboard/src/server/hub.ts`
  containing `console.log('hub: not implemented: plan 009');`.

**Verify**: `node packages/node-runtime/src/main.ts` → prints
`birdsong node-runtime skeleton: frame=32B fast=3010ms`.
(This proves Node can run TypeScript across workspace packages without a build.)

**Verify**: `npm run build -w @birdsong/web && npm run build -w @birdsong/dashboard` → both exit 0.

### Step 8: CI workflow

Create `.github/workflows/ci.yml`: on `push` and `pull_request`; one job on
`ubuntu-latest`; steps: `actions/checkout@v4`, `actions/setup-node@v4` with
`node-version: 24` and `cache: npm`, then `npm ci`, `npm run typecheck`,
`npm test`, `npm run test:e2e`.

**Verify**: `node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!y.includes('npm run typecheck')) process.exit(1)"` → exit 0.

### Step 9: README and commit

Create a short root `README.md`: one paragraph on what BirdSong is (copy the
first paragraph of "Why this matters"), the commands table from this plan,
the three source-code rules from "Current state", and the line
`Detailed plans live in plans/. Protocol constants live in packages/core/src/constants.ts.`

Then: `git add -A && git commit -m "chore: scaffold monorepo and shared contracts"`.

**Verify**: `git log --oneline | wc -l` → `1`.

## Test plan

- Unit tests listed in Step 5 (prng, clock, wav, hex, score, timing, symbols, envs).
- `npm test` → all pass.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with at least 15 passing tests
- [ ] `npm run test:e2e` exits 0 (no tests yet is fine)
- [ ] `node packages/node-runtime/src/main.ts` prints the skeleton line
- [ ] `grep -rnE "from '\.\.?/[^']*'" packages/*/src | grep -v "\.tsx\?'" | wc -l` → `0` (every relative import ends in `.ts` or `.tsx`)
- [ ] `git status --porcelain | wc -l` → `0`
- [ ] `plans/README.md` status row updated

## STOP conditions

- `node packages/node-runtime/src/main.ts` fails with a TypeScript or
  module-resolution error. First try: `npm install -D tsx` and change every
  `"start": "node ..."` script to `"start": "tsx ..."`, then re-run with
  `npx tsx packages/node-runtime/src/main.ts`. If that also fails, STOP.
- `npm install` fails for any package other than `vite-plugin-pwa`.
- `tsc` reports errors in the verbatim files that you cannot fix without
  changing a signature or constant. Do not change signatures; STOP and report.

## Maintenance notes

- `packages/core/src/constants.ts`, `envs.ts`, `timing.ts`, `symbols.ts`,
  `types.ts` and `telemetry.ts` are the contract. A change to any of them
  after this plan lands must be announced in `plans/README.md`, because
  parallel executors rely on them.
- Stubs throw on purpose. `grep -rn "not implemented: plan" packages/` shows
  what is still missing.
