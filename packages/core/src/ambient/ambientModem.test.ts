import { describe, expect, it } from 'vitest';
import { FRAME_AIR_LEN } from '../constants.ts';
import { PROFILE_NAMES } from '../envs.ts';
import type { EnvName } from '../envs.ts';
import { createModem } from '../modem/index.ts';
import { addNoise } from '../modem/channelSim.ts';
import { mulberry32 } from '../util/prng.ts';
import { AMBIENT_LEVEL, renderAmbient } from './index.ts';

const SR = 48_000;
const ENVS: EnvName[] = ['jungle', 'coast', 'city'];

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
}

describe('ambient does not disturb the modem', () => {
  for (const env of ENVS) {
    for (const profile of PROFILE_NAMES) {
      it(`decodes at least 9 of 10 frames under 2x ambient level (${env}, ${profile})`, () => {
        const rng = mulberry32(777);
        const modem = createModem({ sampleRate: SR, env, profile });
        const airs: Uint8Array[] = [];
        const parts: Float32Array[] = [];
        const silence = new Float32Array(SR);
        parts.push(silence);
        for (let i = 0; i < 10; i++) {
          const air = new Uint8Array(FRAME_AIR_LEN);
          for (let b = 0; b < air.length; b++) air[b] = Math.floor(rng() * 256);
          airs.push(air);
          parts.push(modem.encode(air, i % 4), silence);
        }
        const total = parts.reduce((n, p) => n + p.length, 0);
        const signal = new Float32Array(total);
        let pos = 0;
        for (const p of parts) {
          signal.set(p, pos);
          pos += p.length;
        }
        // RMS of the data parts only (silence excluded)
        let sumSq = 0;
        let count = 0;
        for (let i = 0; i < signal.length; i++) {
          if (signal[i] !== 0) {
            sumSq += signal[i]! * signal[i]!;
            count++;
          }
        }
        const sigRms = Math.sqrt(sumSq / Math.max(1, count));

        const bed = renderAmbient(env, total / SR + 1, SR, 5).subarray(0, total);
        const bedScale = (2 * AMBIENT_LEVEL[env] * sigRms) / rms(bed);
        const mixed = new Float32Array(total);
        for (let i = 0; i < total; i++) mixed[i] = signal[i]! + bedScale * bed[i]!;
        const noisy = addNoise(mixed, 15, rng);

        const got: Uint8Array[] = [];
        modem.onFrame((air) => got.push(air.slice()));
        for (let i = 0; i < noisy.length; i += 4096) modem.push(noisy.subarray(i, Math.min(noisy.length, i + 4096)));
        modem.push(new Float32Array(3 * SR));

        let good = 0;
        for (const air of airs) {
          const hit = got.some((g) => {
            let wrong = 0;
            for (let b = 0; b < air.length; b++) if (g[b] !== air[b]) wrong++;
            return wrong <= 4;
          });
          if (hit) good++;
        }
        expect(good).toBeGreaterThanOrEqual(9);
      });
    }
  }
});
