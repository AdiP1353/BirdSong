import { describe, expect, it } from 'vitest';
import { renderAmbient } from './beds.ts';
import { envBand } from '../envs.ts';
import type { EnvName } from '../envs.ts';

function fftPower(re: Float64Array): Float64Array {
  const n = re.length;
  const im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]!; re[i] = re[j]!; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti;
        re[a] = re[a]! + tr; im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  const p = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) p[i] = re[i]! * re[i]! + im[i]! * im[i]!;
  return p;
}

/** Fraction-of-energy in band, in dB relative to total (averaged over Hann-windowed segments). */
function inBandDb(x: Float32Array, sr: number, lowHz: number, highHz: number): number {
  const n = 1 << 15;
  let inBand = 0, total = 0;
  for (let s = 0; s + n <= x.length; s += n / 2) {
    const seg = new Float64Array(n);
    for (let i = 0; i < n; i++) seg[i] = x[s + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    const p = fftPower(seg);
    for (let k = 1; k < p.length; k++) {
      const hz = (k * sr) / n;
      total += p[k]!;
      if (hz >= lowHz && hz <= highHz) inBand += p[k]!;
    }
  }
  return 10 * Math.log10(inBand / total);
}

describe('renderAmbient', () => {
  const sr = 48000;
  const envs: EnvName[] = ['quiet', 'jungle', 'coast', 'city'];
  for (const env of envs) {
    describe(env, () => {
      const a = renderAmbient(env, 10, sr, 1);
      it('has the right length and peak', () => {
        expect(a.length).toBe(10 * sr);
        let peak = 0;
        for (const v of a) peak = Math.max(peak, Math.abs(v));
        if (env === 'quiet') expect(peak).toBe(0);
        else expect(peak).toBeCloseTo(0.5, 3);
      });
      it('is deterministic per seed', () => {
        expect(Array.from(renderAmbient(env, 1, sr, 1))).toEqual(Array.from(renderAmbient(env, 1, sr, 1)));
        if (env !== 'quiet') {
          expect(Array.from(renderAmbient(env, 1, sr, 1))).not.toEqual(Array.from(renderAmbient(env, 1, sr, 2)));
        }
      });
      if (env !== 'quiet') {
        it('keeps its energy at least 25 dB out of the signal band', () => {
          const { lowHz, highHz } = envBand(env);
          expect(inBandDb(a, sr, lowHz, highHz)).toBeLessThan(-25);
        });
      }
    });
  }
});
