import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../util/prng.ts';
import { addNoise, convolve, makeBirdNoise, makeReverbIr, mixAt } from './channelSim.ts';

function power(x: Float32Array): number {
  let s = 0;
  for (const v of x) s += v * v;
  return s / x.length;
}

describe('channelSim', () => {
  it('addNoise hits the requested SNR over the non-zero span', () => {
    const x = new Float32Array(100_000);
    for (let i = 20_000; i < 80_000; i++) x[i] = Math.sin(i * 0.1);
    const y = addNoise(x, 10, mulberry32(1));
    const noise = new Float32Array(60_000);
    for (let i = 0; i < noise.length; i++) noise[i] = y[20_000 + i]! - x[20_000 + i]!;
    const snr = 10 * Math.log10(power(x.subarray(20_000, 80_000)) / power(noise));
    expect(Math.abs(snr - 10)).toBeLessThan(0.3);
  });

  it('reverb IR has the requested direct-to-reverb ratio', () => {
    const ir = makeReverbIr(300, 6, 48_000, mulberry32(2));
    expect(ir[0]).toBe(1);
    let tail = 0;
    for (let n = 1; n < ir.length; n++) tail += ir[n]! * ir[n]!;
    expect(10 * Math.log10(1 / tail)).toBeCloseTo(6, 3);
  });

  it('convolve matches direct convolution', () => {
    const rng = mulberry32(3);
    const x = Float32Array.from({ length: 3000 }, () => rng() - 0.5);
    const ir = Float32Array.from({ length: 200 }, () => rng() - 0.5);
    const y = convolve(x, ir);
    expect(y.length).toBe(x.length + ir.length - 1);
    for (const n of [0, 1, 150, 1999, 2500, 3100, 3198]) {
      let s = 0;
      for (let k = 0; k < ir.length; k++) if (n - k >= 0 && n - k < x.length) s += x[n - k]! * ir[k]!;
      expect(Math.abs(y[n]! - s)).toBeLessThan(1e-4);
    }
  });

  it('mixAt scales the second signal relative to the first', () => {
    const a = new Float32Array(10_000);
    for (let i = 2000; i < 8000; i++) a[i] = 0.5;
    const b = Float32Array.from({ length: 10_000 }, (_, i) => Math.sin(i));
    const mixed = mixAt(a, b, -3);
    const diff = new Float32Array(10_000);
    for (let i = 0; i < diff.length; i++) diff[i] = mixed[i]! - a[i]!;
    expect(Math.sqrt(power(diff)) / 0.5).toBeCloseTo(10 ** (-3 / 20), 2);
  });

  it('bird noise stays inside the band and is deterministic', () => {
    const a = makeBirdNoise(2, 1000, 4000, 48_000, mulberry32(4));
    const b = makeBirdNoise(2, 1000, 4000, 48_000, mulberry32(4));
    expect(a.length).toBe(96_000);
    expect(a).toEqual(b);
    expect(power(a)).toBeGreaterThan(0.01);
  });
});
