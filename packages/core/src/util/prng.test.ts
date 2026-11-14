import { describe, expect, it } from 'vitest';
import { gaussian, mulberry32 } from './prng.ts';

describe('prng', () => {
  it('same seed gives identical values', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
  it('uniform mean is near 0.5', () => {
    const r = mulberry32(1);
    let s = 0;
    for (let i = 0; i < 10_000; i++) s += r();
    expect(Math.abs(s / 10_000 - 0.5)).toBeLessThan(0.02);
  });
  it('gaussian variance is near 1', () => {
    const r = mulberry32(7);
    const xs: number[] = [];
    for (let i = 0; i < 20_000; i++) xs.push(gaussian(r));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    expect(Math.abs(v - 1)).toBeLessThan(0.1);
  });
});
