import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../util/prng.ts';
import { createFountainDecoder, makeDroplet, splitBlocks } from './fountain.ts';

const r = mulberry32(99);
const ri = (n: number) => Math.floor(r() * n);
function distinctSeeds(n: number): number[] {
  const all = Array.from({ length: 255 }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = ri(i + 1);
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  return all.slice(0, n);
}
function envelope(len: number): Uint8Array {
  const e = Uint8Array.from({ length: len }, () => ri(256));
  e[0] = len;
  return e;
}

describe('fountain', () => {
  for (let k = 1; k <= 15; k++) {
    it(`decodes from any ${k} distinct droplets`, () => {
      for (let t = 0; t < 100; t++) {
        const lo = Math.max(14, 16 * (k - 1) + 1);
        const len = lo + ri(16 * k - lo + 1);
        const env = envelope(len);
        const blocks = splitBlocks(env);
        expect(blocks.length).toBe(k);
        const dec = createFountainDecoder(k);
        for (const s of distinctSeeds(k)) dec.add(s, makeDroplet(blocks, s));
        expect(dec.done).toBe(true);
        expect(dec.envelope()).toEqual(env);
      }
    });
  }
  it('duplicate seeds are not innovative; rank counts', () => {
    const blocks = splitBlocks(envelope(60));
    const dec = createFountainDecoder(4);
    const seeds = distinctSeeds(4);
    seeds.forEach((s, j) => {
      expect(dec.add(s, makeDroplet(blocks, s))).toBe(true);
      expect(dec.rank).toBe(j + 1);
      if (j < 3) {
        expect(dec.add(s, makeDroplet(blocks, s))).toBe(false);
        expect(dec.rank).toBe(j + 1);
      }
    });
    expect(dec.add(200, makeDroplet(blocks, 200))).toBe(false);
  });
  it('rejects malformed length headers', () => {
    for (const v of [0, 13, 49]) {
      const env = Uint8Array.from({ length: 48 }, () => ri(256));
      env[0] = v;
      const blocks = splitBlocks(env);
      const dec = createFountainDecoder(3);
      for (const s of [1, 2, 3]) dec.add(s, makeDroplet(blocks, s));
      expect(dec.done).toBe(true);
      expect(dec.envelope()).toBeNull();
    }
  });
});
