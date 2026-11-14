# Plan 003: 32 bytes become a bird-like song, and a noisy recording of that song becomes 32 bytes again

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (edit only your own row).
>
> **Drift check (run first)**:
> `grep -c "not implemented: plan 003" packages/core/src/modem/index.ts` → `1`.
> If the file is missing or the count is 0, STOP.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH (signal processing that must survive real rooms)
- **Depends on**: plans/001-scaffold-and-contracts.md
- **Category**: direction (new feature)
- **Planned at**: no git history (greenfield), 2026-11-14

## Why this matters

BirdSong is an acoustic mesh network: devices send encrypted messages to each
other as synthetic birdsong, speaker to microphone. This plan builds the
modem, which is the "physical language". The encoder turns one 32-byte frame
into a few seconds of chirps that sound like a bird. The decoder listens to a
continuous, noisy microphone stream — with echo, background noise and real
birds — finds those frames and recovers the bytes. If the decoder is fragile,
nothing else in the project works in a real room.

## Current state

After plan 001 the repo is an npm-workspaces TypeScript monorepo. You build on
these existing files in `packages/core/src/` (read each one fully before you
start; do not modify them):

- `types.ts` — the interface you implement:
  ```ts
  export interface RxMeta { sync: number; confidence: number; startSample: number; symbols: number[] }
  export interface ModemOptions { sampleRate: number; env: EnvName; profile: ProfileName; syncThreshold?: number }
  export interface Modem {
    readonly sampleRate: number;
    encode(air: Uint8Array, species: number): Float32Array; // air.length === FRAME_AIR_LEN (32)
    push(pcm: Float32Array): void;
    onFrame(cb: (air: Uint8Array, meta: RxMeta) => void): void;
    busy(): boolean;
    reset(): void;
  }
  ```
- `envs.ts` — `PROFILES` (`stealth`: 90 ms syllable, 30 ms gap, 2 shapes, 4
  bits/symbol, pause of 120 ms after every 8 syllables; `fast`: 40 ms, 10 ms,
  4 shapes, 5 bits/symbol, no pauses), `ENVS` (4 environments, each with 8
  base pitches as MIDI notes), `envPitchesHz(env)`, `envSignalRange(env)`
  (lowest and highest signal frequency), `envBand(env)` (receiver pass band),
  `SWEEP_RATIO`.
- `timing.ts` — the frame layout in milliseconds. One frame on air is:
  ```
  0   .. 160   intro: 3 notes of 40 ms with 20 ms gaps (decoration, NOT decoded)
  160 .. 220   silence
  220 .. 360   sync: up-sweep 60 ms, silence 20 ms, down-sweep 60 ms
  360 .. 400   silence
  400 ..       data symbol i starts at symbolStartMs(i, profile), lasts profile.syllableMs
  last 20 ms   silence (TAIL_MS)
  ```
  Use `SYNC_START_MS`, `SYNC_SWEEP_MS`, `SYNC_GAP_MS`, `SYNC_MS`, `INTRO_NOTE_MS`,
  `INTRO_GAP_MS`, `symbolsPerFrame(p)` (64 for stealth, 52 for fast),
  `symbolStartMs(i, p)`, `frameAirtimeMs(p)` (8910 ms / 3010 ms).
- `symbols.ts` — `bytesToSymbols`, `symbolsToBytes`, `symbolPitchIndex(sym)`
  (low 3 bits), `symbolShape(sym)` (upper bits), `shapeFreqs(pitchHz, shape)`
  which returns `{ start, mid, end }` frequencies: the chirp's frequency moves
  linearly from `start` to `mid` during the first half of the syllable and
  from `mid` to `end` during the second half.
- `constants.ts` — `FRAME_AIR_LEN = 32`, `SPECIES_COUNT = 4`.
- `util/prng.ts` — `mulberry32(seed)`, `gaussian(rng)`.
- The installed `fft.js` package (4.0.4) ships its own types
  (`node_modules/fft.js/lib/fft.d.ts`; read it). `import FFT from 'fft.js'`;
  `new FFT(size)`, size a power of two; `createComplexArray()`,
  `transform(out, in)`, `inverseTransform(out, in)`; `toComplexArray(input, storage)`
  and `fromComplexArray(complex, storage)` take **two** arguments; complex
  arrays are interleaved `[re0, im0, re1, im1, …]`.

**Several executors work in this repository at the same time** (in other
directories). When you run `npm run typecheck` or `npm test`, judge only
errors and failures in files under `packages/core/src/modem/`; errors elsewhere
belong to other executors and are not your STOP condition.
- `modem/index.ts` — the stub you replace. Keep the export
  `createModem(opts: ModemOptions): Modem`.

Source-code rules for this repo (Node runs the `.ts` files directly):
1. Relative imports end in `.ts`. 2. Type-only imports use `import type`.
3. No `enum`, no `namespace`, no constructor parameter properties.

The modem treats the 32 bytes as opaque. It does **not** check CRCs or
correct errors; another layer does. It must emit the demodulated bytes for
every sync it detects, even if they turn out to be garbage.

## Commands you will need

| Purpose   | Command                                   | Expected on success |
|-----------|-------------------------------------------|---------------------|
| Typecheck | `npm run typecheck -w @birdsong/core`     | exit 0              |
| My tests  | `npx vitest run packages/core/src/modem`  | all pass            |
| All tests | `npm test`                                | all pass            |

## Scope

**In scope** (the only files you may create or modify):
- `packages/core/src/modem/index.ts` (replace the stub)
- `packages/core/src/modem/synth.ts`, `templates.ts`, `filters.ts`,
  `detector.ts`, `demod.ts`, `modem.ts`, `channelSim.ts` (create)
- `packages/core/src/modem/*.test.ts` (create)

**Out of scope** (do NOT touch):
- `envs.ts`, `timing.ts`, `symbols.ts`, `constants.ts`, `types.ts` — shared contract.
- `packages/core/src/codec/` — another executor is working there in parallel.
- `package.json`, `package-lock.json`.

## Git workflow

- Commit only `packages/core/src/modem`: `git add packages/core/src/modem && git commit -m "feat(modem): <what>" -- packages/core/src/modem`.
- Other executors may commit in the same repository at the same time. If git
  reports `index.lock` exists, wait 5 seconds and retry.
- Do NOT push.

## Steps

All time-to-sample conversions use `Math.round(ms * sampleRate / 1000)`. The
code must work for any `sampleRate` from 8 000 to 48 000, as long as the
environment's `envBand(env).highHz` is below `0.45 · sampleRate` (phones often
use 44 100; the simulation tests of another plan run the `coast` environment
at 8 000 to be fast). `createModem` throws `RangeError` if the band does not
fit the sample rate. Never hard-code 48 000.

### Step 1: Chirp synthesis — `synth.ts`

```ts
/** One chirp. Frequency goes start -> mid (first half) -> end (second half), linearly. */
export function renderChirp(
  freqs: { start: number; mid: number; end: number },
  durMs: number, sampleRate: number,
  opts?: { taper?: number; harmonic3?: number },
): Float32Array
```

- Phase is the running sum of `2π · f(t) / sampleRate`, starting at 0.
- Sample = `sin(phase) + harmonic3 · sin(3 · phase)`; drop the harmonic term
  if `3 · max(freqs) > 0.45 · sampleRate`.
- Amplitude envelope: a Tukey window with taper fraction `taper` (default
  0.2): raised-cosine rise over the first `taper/2` of the samples,
  raised-cosine fall over the last `taper/2`, 1 in between.

```ts
export function renderFrame(air: Uint8Array, species: number, env: EnvName, profile: ProfileName, sampleRate: number): Float32Array
```

- Output length = `Math.round(frameAirtimeMs(p) * sampleRate / 1000)`, all zeros to start.
- **Species** (`species % 4`) changes only the decoration and the timbre:

  | Species | Intro pitch indices | `taper` | `harmonic3` |
  |---|---|---|---|
  | 0 | 0, 2, 4 | 0.20 | 0 |
  | 1 | 4, 2, 0 | 0.30 | 0.10 |
  | 2 | 1, 5, 3 | 0.15 | 0.20 |
  | 3 | 6, 3, 7 | 0.25 | 0.05 |

- **Intro**: three notes at 0, 60 and 120 ms, each 40 ms long. Note `j` is a
  chirp from pitch `P` to `P · 2^(1/12)` (start = P, end = P·2^(1/12), mid =
  their average) where `P = envPitchesHz(env)[introIndex[j]]`, at 60% of the
  data amplitude, with the species' taper and harmonic.
- **Sync** (identical for every species; `taper 0.1`, no harmonic): with
  `{ lowHz, highHz } = envSignalRange(env)`: an up-sweep `lowHz → highHz` at
  `SYNC_START_MS` lasting `SYNC_SWEEP_MS`, then a down-sweep `highHz → lowHz`
  starting at `SYNC_START_MS + SYNC_SWEEP_MS + SYNC_GAP_MS`.
- **Data**: `symbols = bytesToSymbols(air, p.bitsPerSymbol)`. Symbol `i` is
  `renderChirp(shapeFreqs(envPitchesHz(env)[symbolPitchIndex(s)], symbolShape(s)), p.syllableMs, …)`
  with the species' taper and harmonic, placed at `symbolStartMs(i, p)`.
- Scale the whole frame so its peak absolute value is 0.8.
- Throw `RangeError` if `air.length !== FRAME_AIR_LEN`.

Tests (`synth.test.ts`): output length for both profiles at 48 000 and
44 100; peak is 0.8 ± 0.001; the samples in 160–220 ms and 360–400 ms are all
exactly 0; two different species give different audio but identical samples
inside the sync window (220–360 ms) after dividing each by its own scale
factor (compare the normalised sync segments with tolerance 1e-6 — to make
this testable, export the unscaled builder too, or return the scale factor).

**Verify**: `npx vitest run packages/core/src/modem/synth.test.ts` → all pass.

### Step 2: Receiver templates — `templates.ts`

A template is a **complex** (analytic) version of a chirp:
`t[n] = w[n] · exp(j · phase[n])`, stored as two `Float32Array`s `re` and `im`,
with the same phase and the Tukey window (taper 0.2) as `renderChirp`, **no
harmonic**. Correlating the real microphone signal `x` against it,
`|Σ x[n] · conj(t[n])|`, measures how much of that chirp is present regardless
of the unknown carrier phase. Always use this magnitude; never a real-valued
dot product.

- `buildSymbolTemplates(env, profile, sampleRate)` → one template per symbol
  value `0 .. 2^bitsPerSymbol − 1` (16 for stealth, 32 for fast), plus each
  template's energy `Σ |t|²`.
- `buildSyncTemplate(env, sampleRate)` → one complex template of length
  `SYNC_MS` containing the up-sweep, 20 ms of zeros, and the down-sweep
  (taper 0.1), plus its energy.

Test (`templates.test.ts`): for every environment × profile compute the
normalised cross-correlation matrix
`|Σ a[n]·conj(b[n])| / sqrt(Ea · Eb)` between all pairs of symbol templates.
The diagonal is 1 ± 1e-3. **Every off-diagonal entry must be < 0.6.** Print the
maximum for each case with `console.log` so the number is visible in the test
output.

**Verify**: `npx vitest run packages/core/src/modem/templates.test.ts` → all pass.

### Step 3: Input filter — `filters.ts`

- `createBandpass(lowHz, highHz, sampleRate)` → an object with
  `process(input: Float32Array): Float32Array` that keeps state between calls
  (streaming). Implement as a cascade of two 2nd-order high-pass biquads at
  `lowHz` and two 2nd-order low-pass biquads at `highHz` (RBJ "Audio EQ
  Cookbook" formulas, Q = 0.7071). Clamp `highHz` to `0.45 · sampleRate`.

Test (`filters.test.ts`): a sine at the centre of the band passes with gain
between 0.7 and 1.1 (measure RMS after the first 2000 samples); a sine at
`lowHz / 4` is attenuated to gain < 0.05; a sine at `min(2.5 · highHz, 0.4 · sampleRate)`
is attenuated to gain < 0.2; splitting the input into random-sized chunks
gives the same output as one call (tolerance 1e-6).

**Verify**: `npx vitest run packages/core/src/modem/filters.test.ts` → all pass.

### Step 4: Sync detector — `detector.ts`

Streaming cross-correlation of the band-passed input against the sync template.

- Let `L` = sync template length in samples, `N` = the smallest power of two
  ≥ `4 · L`. Precompute `T` = FFT of the zero-padded complex template.
- Keep an input buffer. Whenever at least `N` unprocessed-window samples are
  available: take a window `x` of `N` samples; `X = FFT(x)`;
  `Y[k] = X[k] · conj(T[k])`; `y = IFFT(Y)`. Then for lags `m = 0 .. N − L`,
  `y[m] = Σ_n x[m+n] · conj(t[n])`. Advance the window by `N − L + 1` samples
  (so consecutive windows overlap by `L − 1` and no lag is skipped).
- Score: `ρ[m] = |y[m]| / sqrt((Et / 2) · Ex[m])`, where `Et = Σ|t|²` and
  `Ex[m] = Σ_{n<L} x[m+n]²` (compute with a running/prefix sum). `ρ` is 0..1.
  If `Ex[m] < 1e-9 · L`, set `ρ[m] = 0` (silence).
- A detection is a lag where `ρ ≥ threshold` (default **0.25**) and `ρ` is the
  maximum within ± `L` samples (non-maximum suppression; handle a maximum that
  sits near a window edge by deferring the decision until the next window, or
  by keeping the last window's tail of `ρ` values).
- Output: `{ sample: absoluteSampleIndexOfSyncStart, score: ρ }`, emitted in
  increasing sample order, each sync once.

Tests (`detector.test.ts`), all at 48 000 Hz, `quiet` environment unless stated:
- A rendered frame placed at sample offset 12 345 inside 6 s of silence is
  detected at 12 345 + round(220 ms) ± 2 samples with score > 0.9.
- Same with white Gaussian noise added at 0 dB SNR (noise power = mean signal
  power over the frame): detected, position ± 4 samples.
- 30 s of white noise only (RMS 0.1): zero detections.
- Feeding the same audio in random chunk sizes 1..5000 gives the same detections.
- Two frames 200 ms apart: two detections.
- Works for each of the 4 environments (one clean case each).

**Verify**: `npx vitest run packages/core/src/modem/detector.test.ts` → all pass.

### Step 5: Symbol demodulator — `demod.ts`

```ts
export function demodulateFrame(
  x: Float32Array,            // band-passed input containing the whole frame
  syncStart: number,          // index in x where the sync starts
  templates: SymbolTemplates, profile: Profile, sampleRate: number,
): { symbols: number[]; confidence: number }
```

- Symbol `i` nominally starts at `syncStart + round((symbolStartMs(i, p) − SYNC_START_MS) · sampleRate / 1000)`.
- For each symbol, for each template, for each timing offset `d` in
  `−D, −D + step, …, +D` where `D = round(0.001 · sampleRate)` (±1 ms) and
  `step = max(1, round(D / 4))`: compute `|Σ x[start + d + n] · conj(t[n])|`.
  The template's score is the maximum over `d`.
- The decided symbol is the template with the highest score. The symbol's
  margin is `(best − secondBest) / best`. `confidence` = mean margin.
- Treat samples outside `x` as 0.

Test (`demod.test.ts`), at 48 000 Hz: for every environment × profile, a clean rendered
frame of 32 random bytes demodulates to exactly the same symbols (given the
exact sync position), and still does when the sync position is off by ±20
samples (inside the ±48-sample search window at this rate).

**Verify**: `npx vitest run packages/core/src/modem/demod.test.ts` → all pass.

### Step 6: Assemble the modem — `modem.ts`, `index.ts`

`createModem(opts)`:
- `encode(air, species)` → `renderFrame(air, species, opts.env, opts.profile, opts.sampleRate)`.
- `push(pcm)`: band-pass with `envBand(opts.env)`; append to a ring buffer
  that always keeps at least the last `frameAirtime + 2 s` of filtered
  samples; feed the detector. Each detection becomes a **pending candidate**
  `{ syncStart, score }`. A candidate is ready when the buffer holds samples up
  to `syncStart + (frameAirtimeMs − SYNC_START_MS)` plus 2 ms. When ready:
  `demodulateFrame`, `symbolsToBytes(symbols, bitsPerSymbol, FRAME_AIR_LEN)`,
  call the `onFrame` callback with `(bytes, { sync: score, confidence, startSample, symbols })`.
- Detection keeps running while candidates are pending. Several candidates may
  be pending at once (overlapping frames from two senders): **never block
  detection while demodulating**.
- `busy()` → true while at least one candidate is pending, **or** while the
  channel shows recent in-band energy. Other devices call `busy()` before they
  sing, so it must react within about 100 ms of someone starting, long before
  the sync has been detected. Energy rule: split the band-passed input into
  consecutive 20 ms blocks and compute each block's mean power. Keep the
  minimum block power of the last 5 s as the noise floor (start with the
  first block's power). A block is "active" if its power is more than 4× the
  noise floor (+6 dB) and also above 1e-7. `busy()` is true if any block in
  the last 250 ms was active (the 250 ms hangover bridges the gaps between syllables).
- `reset()` → clear the buffer, filter state, detector state and candidates.
  Sample indexing may restart at 0.
- `index.ts` exports `createModem` and also re-exports `renderFrame` and
  `renderChirp`.

Tests (`modem.test.ts`):
1. Clean round trip of random 32-byte frames for all 4 environments × 2
   profiles × 4 species (32 cases): the emitted bytes are identical.
2. Sample rate 44 100: clean round trip, `quiet` × both profiles. Sample rate
   8 000: clean round trip, `coast` × both profiles. `createModem` with
   `jungle` at 8 000 throws `RangeError`.
3. Random chunk sizes 1..4096 give the same result as a single `push`.
4. With background noise of RMS 0.005 running for 2 s before the frame:
   `busy()` is false just before the frame starts, is true no later than
   150 ms after the frame starts, stays true until the frame has been
   emitted, and is false again 400 ms after the frame ends.
5. Two frames back to back with a 300 ms gap: both emitted, in order.
6. After `reset()` in the middle of a frame, that frame is not emitted, and a
   later frame is.

**Verify**: `npx vitest run packages/core/src/modem/modem.test.ts` → all pass.

### Step 7: Robustness under a simulated channel — `channelSim.ts` + `robust.test.ts`

`channelSim.ts` (exported, other plans reuse it):

```ts
/** Add white Gaussian noise. snrDb is measured against the mean power of `signal`'s non-zero span. */
export function addNoise(signal: Float32Array, snrDb: number, rng: () => number): Float32Array
/** Synthetic room: direct path + exponentially decaying noise tail. */
export function makeReverbIr(rt60Ms: number, directToReverbDb: number, sampleRate: number, rng: () => number): Float32Array
export function convolve(x: Float32Array, ir: Float32Array): Float32Array
/**
 * Random bird-like chirps inside [lowHz, highHz]: 30-120 ms long, 50-400 ms apart,
 * random direction, each one sweeping between 2% and 30% of its start frequency
 * (real bird syllables are narrow; none of them spans the whole band).
 */
export function makeBirdNoise(seconds: number, lowHz: number, highHz: number, sampleRate: number, rng: () => number): Float32Array
/** Scale `b` so that its RMS is `db` relative to the RMS of `a`'s non-zero span, then add. */
export function mixAt(a: Float32Array, b: Float32Array, db: number): Float32Array
```

`makeReverbIr`: `ir[0] = 1`; for `n ≥ 1`, `ir[n] = g · gaussian · exp(−6.908 · n / (rt60 · sampleRate / 1000))`
for `rt60` worth of samples, with `g` chosen so that `Σ_{n≥1} ir[n]² = 10^(−directToReverbDb / 10)`.
`convolve` may use the FFT (overlap-add) so the tests stay fast.

`robust.test.ts`. Each case: 20 frames of random bytes, seeded PRNG, each
frame embedded in 1 s of leading and trailing silence, processed through the
channel, pushed through a fresh modem. Count per frame: `exact` (bytes
identical) and `fixable` (**at most 4 of the 32 bytes differ**; a later layer
can repair that many). Print the counts with `console.log` for every case.

| # | Channel | Environments × profiles | Required |
|---|---|---|---|
| A | Noise at 0 dB SNR | all 8 | `fixable` ≥ 19/20 |
| B | Reverb RT60 300 ms, direct-to-reverb +6 dB, plus noise at 10 dB | all 4 × stealth | `fixable` ≥ 19/20 |
| C | Same as B | all 4 × fast | `fixable` ≥ 17/20 |
| D | Bird noise in `envBand` at −3 dB relative to the signal, plus noise at 10 dB | all 8 | `fixable` ≥ 18/20 |
| E | 60 s of bird noise at RMS 0.2 + noise RMS 0.05, **no frame** | all 4 × fast | at most 2 `onFrame` calls |
| F | Signal scaled by 0.01 (quiet), noise at 10 dB | quiet × both | `fixable` ≥ 19/20 |

Also add one performance test: pushing 10 s of noise through a `fast` modem
at 48 000 Hz takes less than 3 s of wall time, and demodulating one `stealth`
frame takes less than 2 s.

If a case fails, tune **only these knobs**, in this order: the timing search
half-width `D` (try 0.5–2 ms), the default sync threshold (0.2–0.35), the
template taper (0.1–0.3), and — only if row E (false detections from bird
noise) fails — a **split-sync check**: at each candidate peak, also correlate
the up-sweep half and the down-sweep half of the sync template separately and
accept only if each half's normalised score is at least `threshold / 2` (a
short real chirp matches one half, never both). Do not change anything in
`envs.ts` or `timing.ts`.

**Verify**: `npx vitest run packages/core/src/modem/robust.test.ts` → all pass.

### Step 8: Final checks

**Verify**: `npx vitest run packages/core/src/modem` → all pass.
**Verify**: `npm run typecheck -w @birdsong/core` → exit 0.
**Verify**: `grep -c "not implemented" packages/core/src/modem/index.ts` → `0`.

## Test plan

As listed per step: `synth`, `templates`, `filters`, `detector`, `demod`,
`modem`, `robust` test files in `packages/core/src/modem/`. All randomness
comes from `mulberry32(<fixed seed>)`.

## Done criteria

- [ ] `npx vitest run packages/core/src/modem` exits 0, including all rows of the Step 7 table
- [ ] `npm run typecheck -w @birdsong/core` exits 0
- [ ] `grep -rn "48000\|48_000" packages/core/src/modem --include=*.ts | grep -v test | wc -l` → `0` (no hard-coded sample rate outside tests)
- [ ] `git status --porcelain -- package.json package-lock.json packages/core/src/constants.ts packages/core/src/types.ts packages/core/src/envs.ts packages/core/src/timing.ts packages/core/src/symbols.ts packages/core/src/telemetry.ts` prints nothing (you changed no shared file)
- [ ] `git log -1 --name-only` lists only files under `packages/core/src/modem/` (and `plans/README.md` if you committed it)
- [ ] `plans/README.md` status row updated, with the worst-case `fixable` count of table rows B, C and D written in the "Notes from executors" section

## STOP conditions

- Step 2: some off-diagonal template correlation is ≥ 0.6. Report the
  environment, profile and the two symbols. Do not edit the pitch tables.
- Step 7 row C (`fast` with reverb) still fails after tuning the three allowed
  knobs. This is the expected weak point. Do **not** loop: mark that case
  `it.skip`, record the measured counts in `plans/README.md` notes, set status
  `DONE (fast+reverb below target: n/20)`, and report. Rows A, B, D, E, F are
  mandatory; if one of those fails after tuning, STOP with status BLOCKED.
- The round trip only works at 48 000 Hz and not at 44 100 or 8 000.

## Maintenance notes

- Real rooms are harsher than this simulation. The thresholds here are
  starting values; expect to retune `syncThreshold` on real hardware.
- The harmonic in the species timbre is the 3rd, not the 2nd, on purpose: a
  2nd harmonic of a low pitch lands exactly on another valid pitch one octave up.
- Deferred: tracking clock drift across a frame (today the ±1 ms search covers
  about 100 ppm over a `stealth` frame); soft-decision output for the error
  corrector.
