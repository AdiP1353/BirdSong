import { describe, expect, it } from 'vitest';
import { biquadHighpass, biquadLowpass, loopCrossfade, onePoleHighpass, onePoleLowpass, pinkNoise, sine } from './dsp.ts';
import { mulberry32 } from '../util/prng.ts';

function rms(x: Float32Array, skip = 0): number {
  let s = 0;
  for (let i = skip; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (x.length - skip));
}

describe('ambient dsp', () => {
  const sr = 48000;
  it('4th-order lowpass attenuates a tone at 4x cutoff below 0.02', () => {
    const y = biquadLowpass(sine(sr, 4000, sr), 1000, sr);
    expect(rms(y, 4800) * Math.SQRT2).toBeLessThan(0.02);
  });
  it('4th-order highpass passes high and blocks low tones', () => {
    expect(rms(biquadHighpass(sine(sr, 250, sr), 1000, sr), 4800) * Math.SQRT2).toBeLessThan(0.02);
    expect(rms(biquadHighpass(sine(sr, 4000, sr), 1000, sr), 4800) * Math.SQRT2).toBeGreaterThan(0.9);
  });
  it('one-pole filters attenuate on the correct side', () => {
    expect(rms(onePoleLowpass(sine(sr, 8000, sr), 500, sr), 4800)).toBeLessThan(0.1);
    expect(rms(onePoleHighpass(sine(sr, 50, sr), 5000, sr), 4800)).toBeLessThan(0.05);
  });
  it('pinkNoise is deterministic and non-trivial', () => {
    const a = pinkNoise(1000, mulberry32(3));
    const b = pinkNoise(1000, mulberry32(3));
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(rms(a)).toBeGreaterThan(0.01);
  });
  it('loopCrossfade makes a smooth signal join smoothly', () => {
    const rate = 8000;
    const x = sine(2 * rate, 3.1, rate);
    expect(Math.abs(x[x.length - 1]! - x[0]!)).toBeGreaterThan(0.02);
    const y = loopCrossfade(x, rate / 2);
    expect(y.length).toBe(x.length - rate / 2);
    expect(Math.abs(y[y.length - 1]! - y[0]!)).toBeLessThan(0.02);
  });
});
