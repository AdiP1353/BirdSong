import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../util/prng.ts';
import { compressText, decompressText } from './compress.ts';

function rt(s: string) {
  const c = compressText(s);
  expect(decompressText(c.bytes, c.compressed)).toBe(s);
  return c;
}

describe('compress', () => {
  it('shrinks a sentence', () => {
    const c = rt('Protest moved to the north square at 6pm, bring water');
    expect(c.bytes.length).toBeLessThan(53);
  });
  it('empty', () => void rt(''));
  it('unicode', () => void rt('café 🐦 naïve'));
  it('random lowercase', () => {
    const r = mulberry32(3);
    rt(Array.from({ length: 140 }, () => String.fromCharCode(97 + Math.floor(r() * 26))).join(''));
  });
});
