# Plan 006: A message can be saved as a playable "song" file, and each environment has a camouflage soundscape

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (edit only your own row).
>
> **Drift check (run first)**:
> 1. `grep -c "not implemented: plan 006" packages/core/src/song/index.ts` → `1`.
>    `grep -c "not implemented: plan 006" packages/core/src/ambient/index.ts` → `1` on a first run, or `0` if
>    this plan's status row says `IN PROGRESS (ambient done, …)` (a resumed run: skip to Step 3).
> 2. Steps 1–3 (ambient) need only plan 001. Steps 4–7 (song) need plans 002 and 003:
>    `grep -c "not implemented" packages/core/src/codec/index.ts packages/core/src/modem/index.ts` → `0` for both.
>    If that is not yet true, do Steps 1–3, set your status to `IN PROGRESS (ambient done, song waiting on 002/003)`, and stop.
>    When resumed later, start at Step 3: if it was written with `it.skip`, remove the skip and make it pass, then continue with Step 4.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-scaffold-and-contracts.md (ambient); plans/002-codec.md + plans/003-modem.md (song)
- **Category**: direction (new feature)
- **Planned at**: no git history (greenfield), 2026-11-14

## Why this matters

BirdSong hides encrypted text messages inside synthetic birdsong. Two features
make that "hidden in plain sight" story concrete:

1. **Message songs.** Any message can be rendered as a standalone audio file.
   Play that file from any device — a phone, a laptop, a Bluetooth speaker —
   and a BirdSong node decodes it. That is the physical artefact of the
   language, and it doubles as a reliable way to demo the decoder.
2. **Ambient beds.** Each environment (jungle, coast, city) has a background
   soundscape that a node can play to blend in. The beds are generated in code
   and are deliberately kept **out of the signal band**, so they mask the
   chirps for human ears without disturbing the decoder.

## Current state

Files in `packages/core/src/` you build on (read; do not modify):

- `envs.ts` — `EnvName` (`'quiet' | 'jungle' | 'coast' | 'city'`), `ENVS`,
  `envBand(env)` → the receiver's pass band `{ lowHz, highHz }`. Values
  (computed from the pitch tables; use them to sanity-check, but always call `envBand` in code):

  | Env | `envBand` | 0.6 · low | 0.7 · low | 1.4 · high | 1.6 · high |
  |---|---|---|---|---|---|
  | quiet | 1884–5476 Hz | — | — | — | — |
  | jungle | 1996–7744 Hz | 1197 | 1397 | 10842 | 12390 |
  | coast | 1057–3073 Hz | 634 | 740 | 4302 | 4917 |
  | city | 1778–6899 Hz | 1067 | 1245 | 9659 | 11038 |
- `constants.ts` — `FRAME_AIR_LEN`, `MAX_SEED`.
- `util/prng.ts` — `mulberry32`, `gaussian`.
- `codec/index.ts` (plan 002) — `deriveChannel`, `sealMessage`, `openMessage`,
  `msgIdOf`, `splitBlocks`, `makeDroplet`, `createFountainDecoder`,
  `encodeAirFrame`, `decodeAirFrame`. A 32-byte frame holds one droplet; any
  `k` frames with distinct seeds rebuild a `k`-block message.
- `modem/index.ts` (plan 003) — `createModem({ sampleRate, env, profile })` with
  `encode(air, species)`, `push(pcm)`, `onFrame(cb)`; also `createBandpass(lowHz, highHz, sampleRate)`
  in `modem/filters.ts`, and `addNoise`, `mixAt` in `modem/channelSim.ts`.
- `song/index.ts`, `ambient/index.ts` — stubs with the signatures you must keep:
  ```ts
  export interface SongOptions { passphrase: string; env: EnvName; profile: ProfileName; sampleRate: number }
  export interface DecodedSongMessage { msgId: number; text: string; alias: string }
  export function renderMessageSong(opts: SongOptions & { text: string; alias: string; species: number; sender: number }): Promise<Float32Array>
  export function decodeSong(pcm: Float32Array, opts: SongOptions): Promise<DecodedSongMessage[]>
  export function renderAmbient(env: EnvName, seconds: number, sampleRate: number, seed: number): Float32Array
  ```

Source-code rules: relative imports end in `.ts`; `import type` for types; no
`enum`/`namespace`/constructor parameter properties; no `node:` imports in `packages/core`.

## Commands you will need

| Purpose   | Command                                                      | Expected |
|-----------|--------------------------------------------------------------|----------|
| Typecheck | `npm run typecheck -w @birdsong/core`                        | exit 0   |
| Tests     | `npx vitest run packages/core/src/ambient packages/core/src/song` | all pass |

## Scope

**In scope**: `packages/core/src/ambient/*` and `packages/core/src/song/*` (implementation and tests).
`scripts/render-samples.ts` (create; a dev script, Step 7).

**Out of scope**: every other directory in `packages/core/src/`; `package.json` files; the lockfile.

## Git workflow

Commit only the in-scope paths. Style `feat(ambient): …` / `feat(song): …`.
If git reports `index.lock` exists, wait 5 seconds and retry. Do NOT push.

## Steps

### Step 1: Building blocks — `packages/core/src/ambient/dsp.ts`

Small, self-contained helpers (do not import from `modem/`, which may not exist yet):
- `onePoleLowpass(x, cutoffHz, sampleRate)` and `onePoleHighpass(...)` — return new arrays.
- `biquadLowpass(x, cutoffHz, sampleRate)`, `biquadHighpass(...)` — RBJ cookbook, Q 0.7071, applied twice (4th order).
- `pinkNoise(n, rng)` — Paul Kellet's refined method.
- `sine(n, hz, sampleRate, phase?)`.
- `loopCrossfade(x, fadeSamples)` — returns `x.length − fadeSamples` samples whose end crossfades into its start, so the result loops without a click.

Tests (`dsp.test.ts`): the 4th-order lowpass attenuates a tone at 4× its cutoff below 0.02;
`loopCrossfade` of a 3 Hz sine (2 s at 8000 Hz, which does not loop by itself)
gives `|y[last] − y[0]| < 0.02` (a smooth signal must join smoothly; do not
test this with white noise, whose consecutive samples are never close).

### Step 2: The beds — `packages/core/src/ambient/beds.ts` and `index.ts`

`renderAmbient(env, seconds, sampleRate, seed)` returns `round(seconds · sampleRate)`
samples (generate `seconds + 1` s, then `loopCrossfade` with 1 s), peak-normalised to 0.5.
`quiet` returns all zeros. Let `{ lowHz, highHz } = envBand(env)`. Every
component must sit **below `0.7 · lowHz` or above `1.4 · highHz`**; enforce it by
filtering each component as noted:

| Env | Components |
|---|---|
| jungle | rain: pink noise → lowpass at `0.6 · lowHz`, slow random gain wobble (0.1–0.3 Hz); insects: bursts of a tone at `min(1.6 · highHz, 0.45 · sampleRate)` amplitude-modulated at 30–60 Hz, 0.3–2 s long, 1–4 s apart → highpass at `1.4 · highHz`. **If `1.4 · highHz ≥ 0.45 · sampleRate`, omit the insects.** |
| coast | surf: pink noise → lowpass at `0.6 · lowHz`, gain envelope = slow wave cycle every 6–10 s (raised cosine swell); spray: white noise → highpass at `1.6 · highHz`, following the same swell at −12 dB; gulls: occasional 0.3–0.6 s falling sweeps between `1.8 · highHz` and `min(2.6 · highHz, 0.45 · sampleRate)`, every 4–12 s → highpass at `1.4 · highHz` (omit the gulls if `1.8 · highHz ≥ 0.45 · sampleRate`) |
| city | rumble: pink noise → lowpass at 300 Hz; hum: sines at 50, 100, 150 Hz (amplitudes 1, 0.5, 0.25); distant traffic swells every 5–15 s → lowpass at `0.6 · lowHz` |

`ambient/index.ts` already exports `AMBIENT_LEVEL` (quiet 0, jungle 0.5,
coast 0.7, city 0.6: the recommended playback gain relative to the data
signal). Keep that export exactly; replace only the `renderAmbient` stub body
with a re-export from `beds.ts`.

Tests (`beds.test.ts`), for each env at 48 000 Hz and seed 1, 10 s:
- Length and peak are correct; quiet is all zeros; same seed → identical output; different seed → different output.
- **Band check** (the important one): compute the power spectrum (any FFT or a
  Goertzel sweep in 50 Hz steps) and assert that the energy inside `envBand(env)`
  is **at least 25 dB below** the total energy.

### Step 3: Ambient does not disturb the modem

Only if plan 003 is DONE (else write the test with `it.skip` and a comment `// enable when plan 003 is DONE`).

`ambientModem.test.ts`, at **48 000 Hz** (jungle's band does not fit lower rates): for each of jungle, coast, city × both profiles: 10
frames of random bytes rendered with `createModem(...).encode`, each embedded
in 1 s of silence; add `renderAmbient(env, …)` scaled so its RMS is
`2 × AMBIENT_LEVEL[env]` × the signal's RMS (twice the recommended level, as
a margin), plus white noise at 15 dB SNR. Push through a fresh modem. At least
9 of 10 frames come back with at most 4 wrong bytes.

**Verify**: `npx vitest run packages/core/src/ambient` → all pass.

### Step 4: Rendering a song — `packages/core/src/song/song.ts`

`renderMessageSong(opts)`:
1. `ch = await deriveChannel(passphrase)`; `env = await sealMessage(ch, text, alias)`;
   `msgId = await msgIdOf(env)`; `blocks = splitBlocks(env)`; `k = blocks.length`.
2. Choose `k + 2` seeds: `0, 37, 74, …` (`(i · 37) % 255`, distinct for i < 255).
3. For each seed build the frame `{ netTag: ch.netTag, msgId, k, hop: 0, seed, sender, payload: makeDroplet(blocks, seed) }`,
   `encodeAirFrame`, then `modem.encode(air, species)` with `createModem({ sampleRate, env, profile })`.
4. Concatenate: 0.5 s silence, frame, 0.4 s silence, frame, …, 0.5 s silence.

The two extra droplets mean the song still decodes if any two frames are lost
(a cough, a door slam).

### Step 5: Decoding a song — `packages/core/src/song/decode.ts`

`decodeSong(pcm, opts)`:
1. `modem = createModem(...)`; collect frames from `onFrame`; push the PCM in
   4096-sample chunks, then push 3 s of zeros so the last frame completes.
2. For each frame: `decodeAirFrame` → skip null and frames whose `netTag` differs from the channel's.
3. Group by `msgId` into `createFountainDecoder(k)` instances; when one is done,
   `envelope()` → check `msgIdOf` → `openMessage`. Collect every successfully opened message.
4. Return them in the order they completed. Duplicates (same msgId) only once.

`song/index.ts` re-exports both functions and the two types.

### Step 6: Song tests — `packages/core/src/song/song.test.ts`

Use `sampleRate 16000` and env `coast` (band fits easily, keeps tests fast) unless stated.
- Round trip: render then decode → exactly one message with the same text and alias. Both profiles.
- Two songs concatenated → two messages, in order.
- Drop any two whole frames (zero out their time spans; compute spans with
  `frameAirtimeMs` and the silence layout from Step 4) → still decodes. Try all pairs for a short text with k = 2 (that is 6 pairs).
- Wrong passphrase → empty array.
- Through a channel: `addNoise` at 10 dB → still decodes.
- WAV round trip: `decodeWav(encodeWav(song, 16000))` (from `../util/wav.ts`) → still decodes.
- One `quiet` case at 48 000 Hz with the `fast` profile, to cover the real sample rate.

**Verify**: `npx vitest run packages/core/src/song` → all pass.

### Step 7: Listening samples — `scripts/render-samples.ts`

A dev script, run with `node scripts/render-samples.ts`, that writes into
`samples/` (create it and commit it):
`ambient-<env>.wav` (10 s at 48 000 Hz, 16-bit) for jungle, coast and city, and
`song-<env>-<profile>.wav` **at 24 000 Hz** (every band fits; half the size of 48 kHz) for all 8 combinations with the text
`"Meet at the old bridge at 6"`, alias `"robin"`, passphrase `"demo-flock"`,
plus `song-jungle-stealth+ambient.wav` with the ambient bed mixed in at `AMBIENT_LEVEL.jungle`.
Import from `../packages/core/src/index.ts`.

**Verify**: `node scripts/render-samples.ts && ls samples/*.wav | wc -l` → `12`.
**Verify**: `du -sm samples | cut -f1` → a number below `25`.

## Test plan

`dsp.test.ts`, `beds.test.ts`, `ambientModem.test.ts` in `ambient/`; `song.test.ts` in `song/`.

## Done criteria

- [ ] `npx vitest run packages/core/src/ambient packages/core/src/song` exits 0
- [ ] `npm run typecheck -w @birdsong/core` exits 0
- [ ] `grep -rn "not implemented" packages/core/src/song packages/core/src/ambient | wc -l` → `0`
- [ ] `ls samples/*.wav | wc -l` → `12`
- [ ] `git log -1 --name-only` lists only files under `packages/core/src/song/`, `packages/core/src/ambient/`, `scripts/render-samples.ts`, `samples/` (and `plans/README.md` if you committed it); other executors may have uncommitted files in the tree, which is not your concern
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 2's band check fails for one environment. Do not move the band. Lower
  the offending component's cutoff (or raise its highpass) and, if it still
  fails, drop that component and note it in `plans/README.md`. STOP only if the
  check still fails with every component removed.
- Step 3 or Step 6 fails in a way that points at the modem or the codec
  (for example clean round trips fail). Report it; do not edit those directories.

## Maintenance notes

- The runtimes (Docker node, phone PWA) play the ambient bed on a **separate**
  audio stream that loops, at `AMBIENT_LEVEL[env] × volume`. The engine only stores the `camouflage` flag.
- Optional recorded (CC0) beds can be added later; a recording must be
  band-stopped with `envBand` before use, or it will contain real bird calls inside the signal band.
- Deferred: MIDI export of the score (`util/score.ts` already provides the notes).
