import { describe, expect, it } from 'vitest';
import { envBand } from '../envs.ts';
import { mulberry32 } from '../util/prng.ts';
import { createBandpass } from './filters.ts';

const SR = 48_000;

function sine(f: number, n: number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * f * i) / SR);
  return x;
}

function rms(x: Float32Array, from: number): number {
  let s = 0;
  for (let i = from; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (x.length - from));
}

describe('bandpass', () => {
  const { lowHz, highHz } = envBand('quiet');
  const gain = (f: number): number => {
    const x = sine(f, 20_000);
    const y = createBandpass(lowHz, highHz, SR).process(x);
    return rms(y, 2000) / rms(x, 2000);
  };

  it('passes the band centre', () => {
    const g = gain((lowHz + highHz) / 2);
    expect(g).toBeGreaterThan(0.7);
    expect(g).toBeLessThan(1.1);
  });
  it('rejects below the band', () => {
    expect(gain(lowHz / 4)).toBeLessThan(0.05);
  });
  it('rejects above the band', () => {
    expect(gain(Math.min(2.5 * highHz, 0.4 * SR))).toBeLessThan(0.2);
  });
  it('is chunk-size independent', () => {
    const rng = mulberry32(5);
    const x = new Float32Array(30_000);
    for (let i = 0; i < x.length; i++) x[i] = rng() * 2 - 1;
    const whole = createBandpass(lowHz, highHz, SR).process(x);
    const f = createBandpass(lowHz, highHz, SR);
    const parts: Float32Array[] = [];
    for (let at = 0; at < x.length; ) {
      const len = Math.min(x.length - at, 1 + Math.floor(rng() * 3000));
      parts.push(f.process(x.subarray(at, at + len)));
      at += len;
    }
    const joined = new Float32Array(x.length);
    let o = 0;
    for (const p of parts) {
      joined.set(p, o);
      o += p.length;
    }
    for (let i = 0; i < x.length; i++) expect(Math.abs(joined[i]! - whole[i]!)).toBeLessThan(1e-6);
  });
});
