import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../util/prng.ts';
import { gfExp, gfInv, gfMul } from './gf256.ts';

describe('gf256', () => {
  it('inverse', () => {
    for (let a = 1; a <= 255; a++) expect(gfMul(a, gfInv(a))).toBe(1);
  });
  it('commutative and distributive', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const a = Math.floor(r() * 256), b = Math.floor(r() * 256), c = Math.floor(r() * 256);
      expect(gfMul(a, b)).toBe(gfMul(b, a));
      expect(gfMul(a, b ^ c)).toBe(gfMul(a, b) ^ gfMul(a, c));
    }
  });
  it('exp', () => {
    expect(gfExp(255)).toBe(1);
    expect(gfExp(8)).toBe(29);
  });
});
