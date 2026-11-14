import type { Modem, ModemOptions, RxMeta } from '../types.ts';
import { PROFILES } from '../envs.ts';
import { frameAirtimeMs } from '../timing.ts';
import { FRAME_AIR_LEN } from '../constants.ts';

/**
 * Instant, exact stand-in for the real modem, for mesh-logic tests.
 * Models: a frame occupies the air for its full duration, and two frames that
 * overlap at a receiver destroy each other.
 *
 * Limitations:
 * (1) Needs a noise-free channel; with any noise every frame is dropped.
 * (2) The sim world starts all playback on block boundaries, so two frames
 *     that start in the same block overlap sample for sample: the receiver
 *     then sees a valid-looking magic and emits a blended frame of garbage
 *     bytes instead of dropping it. That is harmless (the frame layer's CRC
 *     and Reed-Solomon reject it, so the node logs `bad crc`), but tests must
 *     not assume "overlap => no onFrame call" in that case.
 */
const MAGIC = [0.5, -0.5, 0.25, -0.25, 0.5, 0.5, -0.5, -0.5];
const CARRIER = 0.0625;
const HEADER_START = 8;

export function createFakeModem(opts: ModemOptions): Modem {
  const sampleRate = opts.sampleRate;
  const frameLen = Math.round(frameAirtimeMs(PROFILES[opts.profile]) * sampleRate / 1000);
  let cb: ((air: Uint8Array, meta: RxMeta) => void) | null = null;

  let counter = 0; // absolute sample counter
  const hist = new Float32Array(8);
  let histFill = 0;
  let state: 'idle' | 'header' | 'carrier' = 'idle';
  let a = 0;
  let startSample = 0;
  let pos = 0; // index within frame of next sample
  let collided = false;
  const bytes = new Uint8Array(FRAME_AIR_LEN);

  function reset() {
    state = 'idle';
    hist.fill(0);
    histFill = 0;
    collided = false;
    pos = 0;
  }

  function step(s: number) {
    if (state === 'idle') {
      for (let i = 0; i < 7; i++) hist[i] = hist[i + 1]!;
      hist[7] = s;
      histFill++;
      counter++;
      if (histFill < 8) return;
      const amp = hist[0]! / 0.5;
      if (amp < 0.02) return;
      const tol = 1e-3 * amp;
      for (let i = 0; i < 8; i++) {
        if (Math.abs(hist[i]! - amp * MAGIC[i]!) > tol) return;
      }
      state = 'header';
      a = amp;
      startSample = counter - 8;
      pos = 8;
      collided = false;
      return;
    }
    counter++;
    if (state === 'header') {
      const v = Math.round((s / a) * 256 + 127.5);
      bytes[pos - HEADER_START] = v < 0 ? 0 : v > 255 ? 255 : v;
      pos++;
      if (pos >= HEADER_START + FRAME_AIR_LEN) state = 'carrier';
    } else {
      if (Math.abs(s - CARRIER * a) > 1e-3 * a) collided = true;
      pos++;
    }
    if (pos >= frameLen) {
      const ok = !collided;
      const out = bytes.slice();
      const start = startSample;
      state = 'idle';
      hist.fill(0);
      histFill = 0;
      if (ok && cb) cb(out, { sync: 1, confidence: 1, startSample: start, symbols: [] });
    }
  }

  return {
    sampleRate,
    encode(air, _species) {
      if (air.length !== FRAME_AIR_LEN) throw new RangeError(`air must be ${FRAME_AIR_LEN} bytes`);
      const out = new Float32Array(Math.max(frameLen, HEADER_START + FRAME_AIR_LEN));
      for (let i = 0; i < 8; i++) out[i] = MAGIC[i]!;
      for (let i = 0; i < FRAME_AIR_LEN; i++) out[HEADER_START + i] = (air[i]! - 127.5) / 256;
      out.fill(CARRIER, HEADER_START + FRAME_AIR_LEN);
      return out;
    },
    push(pcm) {
      for (let i = 0; i < pcm.length; i++) step(pcm[i]!);
    },
    onFrame(f) { cb = f; },
    busy: () => state !== 'idle',
    reset,
  };
}
