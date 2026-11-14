# BirdSong protocol (version 1)

BirdSong is an invented physical language: encrypted text is turned into a
stream of short bird-like chirps. This document describes it precisely enough
to write a compatible encoder or decoder. The source of truth is
`packages/core/src` (file names are given for each section). Any change to the
on-air format must bump `PROTOCOL_VERSION` in `constants.ts` and this file.

## 1. Overview

```
text -> envelope -> blocks -> droplets -> frames -> chirps
```

1. The message text is compressed, then encrypted into an **envelope** (6 to 240 bytes).
2. The envelope is split into **k blocks** of 16 bytes (k is 1 to 15).
3. Each block set yields any number of **droplets** (16 bytes each) with a fountain code. Any k distinct droplets rebuild the message.
4. A droplet gets a 6-byte header, a CRC and Reed-Solomon parity: a 32-byte **frame**.
5. The 32 bytes are cut into symbols; each symbol is one **chirp** (a pitch and a shape). A frame is 3.0 s (fast profile) or 8.9 s (stealth profile) of sound.

Nothing about a message travels except as sound (the dashboard telemetry is an observer channel only).

## 2. Envelope (`codec/crypto.ts`, `codec/compress.ts`)

Layout, in bytes:

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | `len`: total envelope length in bytes (14 to 240: 6 header bytes + 8 tag bytes at least) |
| 1 | 1 | `flags`: bit 0 = plaintext is Unishox2-compressed |
| 2 | 4 | `nonce`: 4 random bytes |
| 6 | n | ciphertext of the plaintext |
| 6+n | 8 | AES-GCM authentication tag (the last 8 bytes of the ciphertext output) |

- **Plaintext** = `alias + "\n" + text` (alias up to 8 characters with no newline; text 1 to 140 characters). It is compressed with Unishox2 only if that is smaller than raw UTF-8 and decompresses back to the same string; otherwise raw UTF-8 and `flags` bit 0 is 0.
- **Key derivation**: PBKDF2-HMAC-SHA-256, password = UTF-8 passphrase, salt = the UTF-8 string `birdsong/v1`, 100 000 iterations, 264 bits (33 bytes) of output. Bytes 0..31 are the AES-256 key. Byte 32 is the **netTag** (channel tag).
- **AES-GCM**: 96-bit IV = the 4-byte nonce followed by 8 zero bytes. Tag length 64 bits. Additional authenticated data = 2 bytes `[PROTOCOL_VERSION, flags]` (so `01 00` or `01 01`).
- **msgId** = the first two bytes of SHA-256(envelope), big-endian (16 bits). It names the message on air; a receiver recomputes it from the decoded envelope and discards the message if it does not match.

## 3. Fountain code (`codec/fountain.ts`, `codec/gf256.ts`)

- Field GF(2^8), primitive polynomial `0x11d`, generator alpha = 2.
- The envelope is zero-padded to `k * 16` bytes and split into blocks `B_0 .. B_(k-1)`.
- Droplet with seed `s` (0 to 254; 255 is reserved) is the byte-wise sum (XOR) over i of `alpha^(s*i) * B_i` (the exponent is taken mod 255).
- Because the coefficient vectors `(1, a, a^2, ... a^(k-1))` with `a = alpha^s` form a Vandermonde matrix, any k droplets with distinct seeds are linearly independent (distinct `a` values, since the seeds are below 255). So any k distinct droplets decode, with no "k plus a few" overhead. There are 255 distinct droplets per message.
- The decoder keeps a reduced row-echelon matrix over GF(2^8). A droplet that does not raise the rank is dropped.
- **Length check**: after decoding, `bytes[0]` is `len`; it must satisfy `14 <= len <= k*16` and `ceil(len/16) == k`. The padding is cut off at `len`. Then msgId and the AES-GCM tag are checked.

## 4. Frame (`codec/frame.ts`, `codec/crc16.ts`, `codec/rs.ts`)

32 bytes on air:

| Bytes | Field |
|---|---|
| 0 | `netTag` |
| 1-2 | `msgId`, big-endian |
| 3 | high nibble `k` (1 to 15; 0 is reserved for control frames and ignored), low nibble `hop` (0 to 15) |
| 4 | `seed` (0 to 254) |
| 5 | `sender` node id (0 to 255; laptops 0-127, phones 128-255 by convention) |
| 6-21 | droplet payload, 16 bytes |
| 22-23 | CRC-16/CCITT-FALSE of bytes 0-21 (poly 0x1021, init 0xFFFF, no reflection, no final XOR), big-endian |
| 24-31 | Reed-Solomon parity, 8 bytes |

Reed-Solomon: systematic RS(32, 24) over GF(2^8) (polynomial 0x11d), generator polynomial `prod_(i=0..7) (x - alpha^i)`, so the first consecutive root is alpha^0. It corrects up to 4 wrong bytes anywhere in the 32. After correction the CRC must still match, otherwise the frame is dropped (this is the guard against RS mis-corrections).

## 5. Modulation (`symbols.ts`, `envs.ts`, `timing.ts`, `modem/synth.ts`)

### Symbols

A symbol value has `3` pitch bits (low bits; index 0 to 7 into the environment's pitch table) and 1 or 2 shape bits above them. The 32 frame bytes are packed most-significant-bit first, zero-padded at the end, into 4-bit symbols (stealth) or 5-bit symbols (fast).

Every chirp starts at its base pitch `f` and spans `f * 2^(3/12)` (3 semitones, `SWEEP_RATIO` 1.1892). With `lo = f`, `hi = f * 1.1892`, `half = (lo+hi)/2`, frequency moves linearly start to mid over the first half of the chirp and mid to end over the second half:

| Shape bits | Name | start | mid | end |
|---|---|---|---|---|
| 0 | up | lo | half | hi |
| 1 | down | hi | half | lo |
| 2 | hook (fast only) | lo | hi | lo |
| 3 | dip (fast only) | hi | lo | hi |

A chirp is `sin(phase)` with phase the running sum of `2*pi*f/fs`, shaped by a Tukey window (raised-cosine edges over the first and last `taper/2` of the chirp). Species (`node id mod 4`) change only decoration: the three intro notes, the taper (0.2, 0.3, 0.15, 0.25) and a small third harmonic (0, 0.1, 0.2, 0.05). The receiver ignores all of that.

### Frame timeline (stealth timings; milliseconds from frame start)

```
 ms     what
   0 -  40   intro note 1  \
  60 - 100   intro note 2   }  3 decorative notes, 40 ms each, 20 ms apart (never decoded)
 120 - 160   intro note 3  /
 160 - 220   silence
 220 - 280   sync up-sweep   (lowest to highest signal frequency)
 280 - 300   silence
 300 - 360   sync down-sweep (highest to lowest)
 360 - 400   silence
 400 -  ...  data symbols; symbol i starts at 400 + i*(syllable + gap) + floor(i/8)*120
             (the 120 ms phrase pause exists only in the stealth profile)
 last symbol end + 20 ms: frame ends
```

Fixed constants: intro 0 to 160 ms, sync starts at 220 ms and lasts 140 ms, data starts at 400 ms, tail 20 ms. Frame audio is peak-normalised to 0.8, intro notes are mixed at 0.6.

### Environments (8 base pitches, ascending)

Generated from `ENVS` with MIDI note n at `440 * 2^((n-69)/12)` Hz:

| Env | Key | Pitches (note, Hz) | Default profile |
|---|---|---|---|
| quiet | C major | C7 2093.0, D7 2349.3, E7 2637.0, F7 2793.8, G7 3136.0, A7 3520.0, B7 3951.1, C8 4186.0 | fast |
| jungle | A major pentatonic | C#7 2217.5, E7 2637.0, F#7 2960.0, A7 3520.0, B7 3951.1, C#8 4434.9, E8 5274.0, F#8 5919.9 | stealth |
| coast | D mixolydian | D6 1174.7, E6 1318.5, F#6 1480.0, G6 1568.0, A6 1760.0, B6 1975.5, C7 2093.0, D7 2349.3 | stealth |
| city | E minor pentatonic | B6 1975.5, D7 2349.3, E7 2637.0, G7 3136.0, A7 3520.0, B7 3951.1, D8 4698.6, E8 5274.0 | fast |

Signal range = lowest pitch to highest pitch x 1.1892; receiver pass band = that range with a 10% margin:

| Env | Signal range (Hz) | Pass band (Hz) |
|---|---|---|
| quiet | 2093 - 4978 | 1884 - 5476 |
| jungle | 2217 - 7040 | 1996 - 7744 |
| coast | 1175 - 2794 | 1057 - 3073 |
| city | 1976 - 6272 | 1778 - 6899 |

The sample rate must put the top of the pass band under 0.45 x fs (jungle needs fs above about 17.2 kHz). Laptops use 48 kHz; phones run at the browser's rate (for example 44.1 kHz).

### Profiles

| Profile | Shapes | Bits per symbol | Syllable | Gap | Phrase pause | Symbols per frame | Frame airtime | Raw bit rate | Payload rate (16 of 32 bytes) |
|---|---|---|---|---|---|---|---|---|---|
| stealth | 2 (up, down) | 4 | 90 ms | 30 ms | 120 ms every 8 symbols | 64 | 8910 ms | 28.7 bit/s | 14.4 bit/s |
| fast | 4 (up, down, hook, dip) | 5 | 40 ms | 10 ms | none | 52 | 3010 ms | 85.0 bit/s | 42.5 bit/s |

(Airtimes come from `frameAirtimeMs(PROFILES.stealth)` and `frameAirtimeMs(PROFILES.fast)`.) All nodes of a channel must use the same environment and profile; a node cannot decode frames sung in another one.

## 6. Receiver (`modem/filters.ts`, `detector.ts`, `demod.ts`, `modem.ts`)

1. **Band-pass**: two 2nd-order high-pass biquads at the lower band edge and two 2nd-order low-pass biquads at the upper edge (RBJ cookbook, Q = 0.7071), streaming.
2. **Sync detection**: normalised complex cross-correlation (FFT, overlap-save) of the filtered stream against the sync template (up-sweep, 20 ms of zeros, down-sweep, Tukey taper 0.1). Score rho = `|sum x * conj(t)| / sqrt(Et/2 * sum x^2)`. A peak above the threshold **0.25** is a candidate; the best score within one template length (140 ms) is kept.
3. **Wait and demodulate**: the modem waits until the rest of the frame (airtime minus 220 ms, plus 2 ms) has arrived. For every symbol it takes the nominal start time relative to the sync, correlates the window against all `2^bitsPerSymbol` complex templates (no harmonics) at 9 timing offsets spread across +-1 ms, and picks the symbol with the largest magnitude. Output: 32 bytes, possibly with errors, plus a sync score and a mean decision margin.
4. **Frame check**: Reed-Solomon, CRC, netTag, then the engine logic of section 7.
5. **Busy detection** (carrier sense): the band-passed signal is cut into 20 ms blocks; the noise floor is the minimum block power over the last 5 s. A block is "active" if its power exceeds 4 x the floor and 1e-7. The channel counts as busy while a sync candidate is pending and for 250 ms after the last active block. (Sync is only detected about 0.4 s into a frame, which is too late for listen-before-sing, hence the energy test.)

## 7. Medium access and gossip (`node/engine.ts`, `node/params.ts`, `node/trickle.ts`)

Parameters (`NODE_PARAMS`, `constants.ts`):

| Name | Value |
|---|---|
| `LISTEN_BEFORE_MS` + `JITTER_MS` | 200 ms + uniform 0 to 400 ms |
| `BACKOFF_MIN_MS` / `BACKOFF_MAX_MS` | 500 / 3000 ms (uniform), at most `MAX_BACKOFFS` = 20, then sing anyway |
| `DEAF_TAIL_MS` | 150 ms after own playback ends, then the modem is reset |
| `TRICKLE_IMIN_MS` / `TRICKLE_IMAX_MS` / `TRICKLE_K` | 10 s / 60 s / 2 |
| `SWEEP_MS` | 10 s (drops stale undecoded entries older than the TTL) |
| `MSG_TTL_MS` | 300 000 ms (5 min) |
| `HOP_LIMIT` | 8 |
| Tombstones | up to 1024 expired msgIds are remembered |

Rules:

- **Half duplex**: a node ignores its microphone while it sings, while muted, and for 150 ms after singing.
- **Accept a frame** only if RS and CRC pass, the netTag matches the channel, `sender` is not itself, `sender` is in the optional neighbour list, `k >= 1`, the msgId is not tombstoned, and `k` matches earlier frames of the same msgId. `hop` of the local copy is the smallest `frame.hop + 1` seen.
- **Decode**: when k independent droplets are in, the envelope is rebuilt; the msgId hash and the AES-GCM tag must verify, otherwise the entry is dropped.
- **Writer**: a new message is queued as a burst of `k + 1` droplets (distinct random seeds), then Trickle.
- **Relay**: a node that has decoded a message with hop below 8 queues a burst of `k` droplets, then Trickle. A queued burst item is skipped if, since the node decoded, it has already heard `k` or more frames of that message from others (burst suppression).
- **Trickle**: intervals start at 10 s and double to 60 s. In each interval one fire time is chosen uniformly in the second half; if fewer than 2 consistent frames of that message were heard in the interval, one more droplet (a seed not yet used) is queued.
- **Before every transmission**: wait 200 ms + 0 to 400 ms, then if the modem reports busy, back off 0.5 to 3 s and try again (up to 20 times).
- **Expiry**: 5 minutes after a node holds a message, it stops relaying it and keeps only a tombstone.
- **Telemetry**: nodes also report events to the dashboard hub (observer only, not part of the air protocol).

## 8. Airtime

A writer sings k + 1 frames, each lasting one frame airtime, plus the listen delay (200 to 600 ms) before each. A 140-character message needs k = 6 to 7 in our measurements (an envelope of 90 to 102 bytes), so the writer's burst is 7 to 8 frames: about 62 to 71 s in the stealth profile (8.91 s each) and 21 to 24 s in the fast profile (3.01 s each), before the neighbour can decode. A multi-hop route repeats that for each hop, so with stealth a single hop takes roughly 1 to 1.5 minutes and relays can start singing only after they decode. Measured numbers from the simulated mesh are in `plans/README.md` ("Notes from executors").

## 9. Limitations

- **Short nonce**: 4 random bytes with one key. The IV repeats after tens of thousands of messages on one passphrase (birthday bound near 2^16), which would break AES-GCM for those messages.
- **Shared passphrase**: one key per channel, no per-person keys, no forward secrecy. Anyone with the passphrase can read, forge and replay messages (a replay after the 5-minute TTL is accepted again).
- **Channel fingerprint**: `netTag` is sent in clear in every frame, so an observer who can decode frames can group them by channel. The frame header (msgId, k, hop, seed, sender) is also in clear.
- **Small ids**: msgId is 16 bits, so two live messages can collide (about 1 in 65 536 per pair); netTag is 8 bits, so a different channel matches by chance 1 time in 256.
- **Slow**: see section 8. Frames from several singers at once collide; the protocol only uses carrier sense, with no acknowledgements.
- **False sync matches**: the receiver sometimes reports extra frames (for example inside reverb tails); the RS and CRC layer discards them.
- **Size**: at most 15 blocks (a 240-byte envelope), so some 140-character texts that compress badly can be refused.
- **iOS Safari audio routing**: not tested on a real iPhone; phone audio may go to the earpiece or be muted.
- **No AI/LLM component**: compression is the static Unishox2 dictionary.
