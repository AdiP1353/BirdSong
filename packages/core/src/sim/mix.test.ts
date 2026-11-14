import { describe, expect, it } from 'vitest';
import { gainBetween, mixBlock } from './mix.ts';
import { mulberry32 } from '../util/prng.ts';

describe('gainBetween', () => {
  it('is 1 at distance <= 1', () => {
    expect(gainBetween({ x: 0, y: 0 }, { x: 0, y: 0 }, 3)).toBe(1);
    expect(gainBetween({ x: 0, y: 0 }, { x: 1, y: 0 }, 3)).toBe(1);
    expect(gainBetween({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 3)).toBe(1);
  });
  it('is 0.5 at distance 2 with range 3', () => {
    expect(gainBetween({ x: 0, y: 0 }, { x: 2, y: 0 }, 3)).toBeCloseTo(0.5);
  });
  it('is 0 beyond range', () => {
    expect(gainBetween({ x: 0, y: 0 }, { x: 3.1, y: 0 }, 3)).toBe(0);
  });
});

describe('mixBlock', () => {
  const rng = mulberry32(1);
  it('sums other speakers exactly and excludes own signal', () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([10, 20, 30]);
    const c = new Float32Array(3);
    const gains = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
    const rx = mixBlock([a, b, c], gains, 0, rng);
    expect(Array.from(rx[2]!)).toEqual([11, 22, 33]);
    expect(Array.from(rx[0]!)).toEqual([10, 20, 30]);
    expect(Array.from(rx[1]!)).toEqual([1, 2, 3]);
  });
  it('adds noise with the requested RMS', () => {
    const z = [new Float32Array(20000), new Float32Array(20000)];
    const rx = mixBlock(z, [[1, 1], [1, 1]], 0.1, mulberry32(7));
    let s = 0;
    for (const v of rx[0]!) s += v * v;
    const rms = Math.sqrt(s / rx[0]!.length);
    expect(Math.abs(rms - 0.1)).toBeLessThan(0.01);
  });
});
