# Plan 002: Text becomes encrypted, erasure-coded, error-corrected 32-byte frames — and back

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (edit only your own row).
>
> **Drift check (run first)**:
> `grep -c "not implemented: plan 002" packages/core/src/codec/index.ts` → `1`.
> If the file is missing or the count is 0, STOP: either plan 001 has not
> landed or someone already implemented this plan.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (Reed–Solomon decoder is the hard part)
- **Depends on**: plans/001-scaffold-and-contracts.md
- **Category**: direction (new feature)
- **Planned at**: no git history (greenfield), 2026-11-14

## Why this matters

BirdSong sends text messages as birdsong between devices. Sound is a slow and
lossy channel: about 30–100 bits per second, and whole frames get lost when a
real bird sings over them or a device goes away. This plan builds the data
layer that makes that survivable. A message is compressed, encrypted with a
shared passphrase, cut into 16-byte blocks, and turned into an unlimited
supply of interchangeable "droplets". **Any K distinct droplets rebuild a
K-block message**, no matter which devices they came from. Each droplet travels
in a 32-byte frame that can repair up to 4 corrupted bytes by itself.

## Current state

After plan 001 the repo is an npm-workspaces TypeScript monorepo. Relevant files:

- `packages/core/src/constants.ts` — protocol constants. You will use:
  `BLOCK_SIZE = 16`, `MAX_K = 15`, `MAX_SEED = 254`, `HEADER_LEN = 6`,
  `FRAME_BODY_LEN = 24`, `RS_PARITY_LEN = 8`, `FRAME_AIR_LEN = 32`,
  `MAX_TEXT_CHARS = 140`, `MAX_ALIAS_CHARS = 8`, `ENVELOPE_HEADER_LEN = 6`,
  `GCM_TAG_LEN = 8`, `NONCE_RANDOM_LEN = 4`, `MAX_ENVELOPE_LEN = 240`,
  `PBKDF2_SALT = 'birdsong/v1'`, `PBKDF2_ITERATIONS = 100_000`,
  `PROTOCOL_VERSION = 1`. Import them; never hard-code the numbers.
- `packages/core/src/types.ts` — defines `Frame`:
  ```ts
  export interface Frame {
    netTag: number; // 0..255
    msgId: number;  // 0..65535
    k: number;      // 1..15 source blocks. 0 is reserved.
    hop: number;    // 0..15
    seed: number;   // 0..254
    sender: number; // 0..255
    payload: Uint8Array; // BLOCK_SIZE bytes
  }
  ```
- `packages/core/src/codec/index.ts` — a **stub** that exports the exact
  signatures you must keep (`Channel`, `FountainDecoder`, `deriveChannel`,
  `sealMessage`, `openMessage`, `msgIdOf`, `splitBlocks`, `makeDroplet`,
  `createFountainDecoder`, `encodeAirFrame`, `decodeAirFrame`). Every function
  currently throws `not implemented: plan 002`. You replace the bodies. **Do
  not change any exported name or signature**: other plans compile against them.

Source-code rules for this repo (Node runs the `.ts` files directly):
1. Relative imports end in `.ts`: `import { gfMul } from './gf256.ts'`.
2. Type-only imports use `import type`.
3. No `enum`, no `namespace`, no constructor parameter properties.

Crypto comes from WebCrypto, `globalThis.crypto.subtle`, which exists in both
Node and browsers. Do not import `node:crypto`: this code also runs on phones.
If TypeScript rejects a `Uint8Array` argument to a `subtle.*` call
(`ArrayBufferLike` not assignable), pass `x.slice()`; do not change signatures.

**Several executors work in this repository at the same time** (in other
directories). When you run `npm run typecheck` or `npm test`, judge only
errors and failures in files under `packages/core/src/codec/`; errors in
other directories belong to other executors and are not your STOP condition.

## Commands you will need

| Purpose   | Command                                   | Expected on success |
|-----------|-------------------------------------------|---------------------|
| Typecheck | `npm run typecheck -w @birdsong/core`     | exit 0              |
| My tests  | `npx vitest run packages/core/src/codec`  | all pass            |
| All tests | `npm test`                                | all pass            |

## Scope

**In scope** (the only files you may create or modify):
- `packages/core/src/codec/index.ts` (replace the stub with re-exports)
- `packages/core/src/codec/gf256.ts`, `rs.ts`, `crc16.ts`, `frame.ts`,
  `fountain.ts`, `compress.ts`, `crypto.ts` (create)
- `packages/core/src/codec/*.test.ts` (create)

(`packages/core/src/unishox.d.ts` already exists from plan 001; do not edit it.)

**Out of scope** (do NOT touch):
- `packages/core/src/constants.ts`, `types.ts` — the shared contract.
- `package.json`, `package-lock.json` — all dependencies are already installed.
  If something seems missing, STOP.
- Everything outside `packages/core/src/codec/` except the one `.d.ts` above.

## Git workflow

- Commit only your in-scope paths: `git add packages/core/src/codec && git commit -m "<message>" -- packages/core/src/codec`.
- Commit per step or at the end; message style `feat(codec): <what>`.
- Other executors may be committing in the same repository at the same time.
  If git reports `index.lock` exists, wait 5 seconds and retry.
- Do NOT push.

## Steps

### Step 1: GF(256) arithmetic — `gf256.ts`

Field: GF(2⁸) with primitive polynomial `0x11d` and generator `α = 2`.

- Build `EXP` (length 512, so `EXP[i + 255] === EXP[i]`) and `LOG` (length 256) tables at module load.
- Export `gfMul(a, b)`, `gfDiv(a, b)` (throw on `b === 0`), `gfInv(a)`,
  `gfPow(a, n)` (n ≥ 0), `gfExp(n)` (= αⁿ, n reduced mod 255, n may be any
  non-negative integer). `gfMul` with either operand 0 returns 0.

Tests (`gf256.test.ts`): `gfMul(a, gfInv(a)) === 1` for all a in 1..255;
`gfMul` is commutative and distributes over XOR for 1000 random triples;
`gfExp(255) === 1`; `gfExp(8) === 29`.

**Verify**: `npx vitest run packages/core/src/codec/gf256.test.ts` → all pass.

### Step 2: Reed–Solomon — `rs.ts`

Code: RS over GF(256), generator polynomial `g(x) = ∏_{i=0}^{nsym-1} (x − αⁱ)`
(first consecutive root = 0). Systematic: codeword = data followed by parity.

```ts
/** Returns data followed by `nsym` parity bytes. */
export function rsEncode(data: Uint8Array, nsym: number): Uint8Array
/** Corrects up to floor(nsym/2) byte errors. Returns null if uncorrectable. */
export function rsDecode(codeword: Uint8Array, nsym: number): { data: Uint8Array; corrected: number } | null
```

Decoder algorithm (the standard one; implement it in this order):
1. Syndromes `S_i = codeword(αⁱ)` for `i = 0..nsym-1`, treating `codeword[0]`
   as the highest-degree coefficient. If all are 0 → return the data, `corrected: 0`.
2. Berlekamp–Massey to get the error-locator polynomial. If its degree
   `> nsym/2` → return null.
3. Chien search: find every position whose inverse locator is a root. If the
   number of roots ≠ the locator degree → return null.
4. Forney's formula for the error magnitudes; XOR them into the codeword.
5. **Recompute the syndromes on the corrected codeword. If any is non-zero → return null.**
6. Return the first `codeword.length − nsym` bytes and the number of corrected bytes.

Tests (`rs.test.ts`), with `nsym = 8` and 24-byte data, using a seeded
`mulberry32` from `../util/prng.ts`:
- Clean round trip for 200 random inputs.
- For each error count e in 1..4: 500 trials, corrupt e distinct random
  positions (anywhere in the 32 bytes, each XORed with a random non-zero
  byte) → decode returns the original data and `corrected === e`.
- For e in 5..8: 500 trials each → the result is either `null` or data that
  **differs** from the original (count both; assert the function never throws).

**Verify**: `npx vitest run packages/core/src/codec/rs.test.ts` → all pass.

### Step 3: CRC and frames — `crc16.ts`, `frame.ts`

`crc16.ts`: `export function crc16(bytes: Uint8Array): number` — CRC-16/CCITT-FALSE:
polynomial `0x1021`, initial value `0xFFFF`, no reflection, no final XOR.
Test: `crc16` of the ASCII bytes of `"123456789"` is `0x29B1`.

`frame.ts`: the on-air layout is

| Byte(s) | Field |
|---|---|
| 0 | `netTag` |
| 1–2 | `msgId`, big-endian |
| 3 | `(k << 4) | hop` |
| 4 | `seed` |
| 5 | `sender` |
| 6–21 | `payload` (16 bytes) |
| 22–23 | `crc16` of bytes 0–21, big-endian |
| 24–31 | Reed–Solomon parity of bytes 0–23 |

- `encodeAirFrame(frame)`: throw `RangeError` if any field is outside its range
  (`k` 1..15, `hop` 0..15, `seed` 0..254, `netTag`/`sender` 0..255, `msgId`
  0..65535, payload length 16). Return 32 bytes.
- `decodeAirFrame(air)`: return null if `air.length !== FRAME_AIR_LEN`; run
  `rsDecode(air, RS_PARITY_LEN)` → null if it fails; check the CRC → null on
  mismatch; parse; return null if `k === 0` or `seed > MAX_SEED`. Return
  `{ frame, corrected }`. The returned `payload` must be a copy, not a view.

Tests (`frame.test.ts`): round trip of 200 random valid frames; 1..4 random
byte errors still decode to the identical frame; in 2000 trials with 6 random
byte errors the result is **never a frame that differs from the original**
(null or identical only); out-of-range fields throw.

**Verify**: `npx vitest run packages/core/src/codec/frame.test.ts packages/core/src/codec/crc16.test.ts` → all pass.

### Step 4: Fountain (rateless erasure code) — `fountain.ts`

- `splitBlocks(envelope)`: `k = Math.ceil(envelope.length / BLOCK_SIZE)`; throw
  `RangeError` if `k < 1` or `k > MAX_K`; return `k` blocks of exactly 16 bytes,
  the last one zero-padded.
- `makeDroplet(blocks, seed)`: throw if `seed < 0 || seed > MAX_SEED`. With
  `x = gfExp(seed)`, the coefficient of block `i` is `xⁱ` = `gfExp(seed * i)`.
  Droplet byte `b` = XOR over `i` of `gfMul(gfExp(seed * i), blocks[i][b])`.
  (This is a Vandermonde code: **any k droplets with distinct seeds are
  linearly independent**, so any k distinct droplets decode.)
- `createFountainDecoder(k)`: keeps a matrix of at most `k` rows, each row =
  `k` coefficients + 16 payload bytes, in reduced form with one pivot per row.
  - `add(seed, payload)`: return false if `done`, if the seed is out of range,
    or if `payload.length !== 16`. Build the row, eliminate it against the
    existing pivot rows. If the coefficient part becomes all zeros → return
    false (not innovative). Otherwise normalise the row so its pivot is 1,
    eliminate that pivot column from all other rows, store it, increment
    `rank`, and return true.
  - `done` is `rank === k`.
  - `envelope()`: null unless `done`. Order the rows by pivot column; the
    payload parts are now the original blocks. Concatenate them; let
    `len = bytes[0]`. Return null if `len < ENVELOPE_HEADER_LEN + GCM_TAG_LEN`,
    or `len > k * BLOCK_SIZE`, or `Math.ceil(len / BLOCK_SIZE) !== k`.
    Otherwise return a copy of the first `len` bytes.

Tests (`fountain.test.ts`), seeded PRNG:
- For every k in 1..15: 100 trials. Random envelope whose length `len` is a
  random value in `max(14, 16(k − 1) + 1) .. 16k` (14 is the smallest valid
  envelope), with `bytes[0]` set to `len`. Pick k **distinct** random seeds
  from 0..254, feed the droplets in random order → `done` is true and
  `envelope()` equals the original. This must succeed in 100% of trials.
- Feeding the same seed twice returns false the second time and does not change `rank`.
- `rank` after j distinct droplets is exactly j (for j ≤ k).
- For k = 3: an envelope whose first byte is `0`, `13`, or `49` (none of them
  gives `ceil(v / 16) === 3` with `v ≥ 14`) → `envelope()` is null.

**Verify**: `npx vitest run packages/core/src/codec/fountain.test.ts` → all pass.

### Step 5: Compression — `compress.ts`

```ts
/** Returns the smaller of Unishox2-compressed and raw UTF-8. */
export function compressText(s: string): { compressed: boolean; bytes: Uint8Array }
export function decompressText(bytes: Uint8Array, compressed: boolean): string
```

The package `unishox2.siara.cc` (version 1.1.5) is installed in
`node_modules`. Its API: `unishox2_compress_simple(inputString, inputString.length, outUint8Array)`
→ compressed length, and `unishox2_decompress_simple(inUint8Array, length)` →
string. Two known traps:
- It is a CommonJS module. Import it as a default and destructure:
  `import unishox from 'unishox2.siara.cc'; const { unishox2_compress_simple, unishox2_decompress_simple } = unishox;`
  (named imports may fail under plain Node).
- The compress function can return a **fractional** length (it computes
  `(bits + 7) / 8` without rounding). Use `Math.ceil(n)` bytes of the output.

The first line of `compress.ts` must be `/// <reference path="../unishox.d.ts" />`
(the type declaration, already written by plan 001), so packages that import
core also see it.

`compressText` must be safe: compress into a 512-byte buffer, then decompress
the result and compare with the input. Use the compressed form only if the
round trip is exact **and** it is shorter than the UTF-8 bytes; otherwise
return the raw UTF-8 bytes with `compressed: false`. Wrap the library calls in
try/catch and fall back to raw on any exception.

Tests (`compress.test.ts`): round trip for `"Protest moved to the north square at 6pm, bring water"`,
for `""`, for a string with emoji and accents (`"café 🐦 naïve"`), and for 140
random lowercase letters. For the first sentence assert
`bytes.length < 53` (it actually got smaller).

**Fallback (allowed, not a STOP)**: if after 30 minutes the library cannot be
made to work in both `npx vitest` and plain `node` (check with
`node -e "import('unishox2.siara.cc').then(m=>console.log(Object.keys(m)))"`),
implement `compressText` as raw UTF-8 only (`compressed: false` always), skip
the `< 53` assertion with `it.skip`, and write
`002: Unishox2 unusable, messages are sent uncompressed` in the "Notes from
executors" section of `plans/README.md`.

**Verify**: `npx vitest run packages/core/src/codec/compress.test.ts` → all pass.

### Step 6: Encryption envelope — `crypto.ts`

- `deriveChannel(passphrase)`: PBKDF2 with SHA-256, salt = UTF-8 of
  `PBKDF2_SALT`, `PBKDF2_ITERATIONS` iterations, `deriveBits` for **264 bits**.
  Bytes 0–31 → AES-GCM key via `importKey('raw', …, 'AES-GCM', false, ['encrypt', 'decrypt'])`.
  Byte 32 → `netTag`.
- `sealMessage(ch, text, alias, nonce4?)`:
  1. Validate: `[...text].length` is 1..`MAX_TEXT_CHARS`; `[...alias].length ≤ MAX_ALIAS_CHARS`;
     `alias` contains no `'\n'`. Otherwise throw `RangeError`.
  2. `plain = compressText(alias + '\n' + text)`; `flags = plain.compressed ? 1 : 0`.
  3. `nonce4` = the argument, or 4 bytes from `crypto.getRandomValues`.
     IV (12 bytes) = `nonce4` followed by 8 zero bytes.
  4. Encrypt with `{ name: 'AES-GCM', iv, tagLength: 64, additionalData: Uint8Array.of(PROTOCOL_VERSION, flags) }`.
     WebCrypto returns ciphertext with the 8-byte tag appended.
  5. Envelope = `[len][flags][nonce4 (4 bytes)][ciphertext+tag]` where
     `len` = the total envelope length. Throw `RangeError('message too long')`
     if the total exceeds `MAX_ENVELOPE_LEN`.
- `openMessage(ch, envelope)`: return null if `envelope.length < 14` or
  `envelope[0] !== envelope.length`. Decrypt with the same parameters; on any
  exception return null. Decompress, split at the **first** `'\n'`, return
  `{ alias, text }`.
- `msgIdOf(envelope)`: SHA-256 of the envelope; return `(d[0] << 8) | d[1]`.

Tests (`crypto.test.ts`):
- Round trip with alias `"robin"` and a 140-character text.
- A different passphrase → `openMessage` returns null.
- Flipping any single bit of the envelope (try every byte, bit 0) → null.
- `deriveChannel` twice with the same passphrase gives the same `netTag`.
- A 141-character text throws.
- 140 characters of random printable ASCII still fits (does not throw), and
  `splitBlocks(envelope).length ≤ 15`.
- Same text sealed twice gives different envelopes (random nonce) but both open.

**Verify**: `npx vitest run packages/core/src/codec/crypto.test.ts` → all pass.

### Step 7: Wire up `index.ts` and run everything

Replace `packages/core/src/codec/index.ts` with re-exports. Keep the
`Channel` and `FountainDecoder` interfaces exported from this file (move
them into `crypto.ts` / `fountain.ts` and re-export with `export type { … }`).
Also export `crc16`, `rsEncode`, `rsDecode`, `compressText`, `decompressText`,
and the `gf*` functions.

Add `pipeline.test.ts`, the end-to-end check of this layer:
text → `sealMessage` → `splitBlocks` → for 2k random distinct seeds:
`makeDroplet` → `encodeAirFrame` → corrupt 3 random bytes of each frame →
keep a random k of the 2k frames and discard the rest → `decodeAirFrame` → `createFountainDecoder`
→ `envelope()` → check `msgIdOf` matches the frames' `msgId` → `openMessage`
→ the same text. Run it for 50 random texts of length 1..140.

**Verify**: `npx vitest run packages/core/src/codec` → all pass.
**Verify**: `npm run typecheck -w @birdsong/core` → exit 0.
**Verify**: `grep -c "not implemented" packages/core/src/codec/index.ts` → `0`.
**Verify**: `node -e "import('@birdsong/core').then(async m=>{const c=await m.deriveChannel('x');const e=await m.sealMessage(c,'hi','me');console.log((await m.openMessage(c,e)).text)})"`
(run from `packages/node-runtime/`) → prints `hi`. This proves the codec also
runs under plain Node, not only under Vitest.

## Test plan

Covered per step. Total: at least 30 test cases across 8 test files in
`packages/core/src/codec/`. Use `mulberry32(<fixed seed>)` from
`packages/core/src/util/prng.ts` for all randomness so failures reproduce.

## Done criteria

- [ ] `npx vitest run packages/core/src/codec` exits 0
- [ ] `npm run typecheck -w @birdsong/core` exits 0
- [ ] `grep -rn "not implemented" packages/core/src/codec/ | wc -l` → `0`
- [ ] The exported names and signatures in `codec/index.ts` are a superset of the stub's
- [ ] `git status --porcelain -- package.json package-lock.json packages/core/src/constants.ts packages/core/src/types.ts packages/core/src/envs.ts packages/core/src/timing.ts packages/core/src/symbols.ts packages/core/src/telemetry.ts packages/core/src/unishox.d.ts` prints nothing (you changed no shared file)
- [ ] `git log -1 --name-only` lists only files under `packages/core/src/codec/` (and `plans/README.md` if you committed it)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The Reed–Solomon error-correction tests (Step 2, e in 1..4) still fail after
  two full rewrites of the decoder. Then: make `rsDecode` **detect-only**
  (return the data when all syndromes are zero, otherwise null), mark the
  correction tests `it.skip`, finish the other steps, set your status to
  `DONE (RS detect-only)` and report. The rest of the system still works with
  detect-only, just with more lost frames.
- You believe a constant or the `Frame` type must change.
- `globalThis.crypto.subtle` rejects `tagLength: 64` or 264-bit `deriveBits`.

## Maintenance notes

- The nonce has only 4 random bytes. With one passphrase, two messages share a
  nonce with probability about n²/2³³. That is acceptable for a demo and must
  be stated in `docs/PROTOCOL.md` as a known limitation; a production design
  needs a longer nonce.
- `k = 0` in the frame header is reserved for future control frames (for
  example a "I am missing droplets" request). `decodeAirFrame` rejects it today.
- The limit is really **240 envelope bytes**, not 140 characters: 140 ASCII
  characters always fit, but 140 emoji or CJK characters do not and throw
  `RangeError('message too long')`. The UI shows that error message.
- The fountain has only 255 distinct droplets per message. Relays pick seeds
  at random, so two relays occasionally send the same one; that only wastes airtime.
