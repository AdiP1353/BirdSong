import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../util/prng.ts';
import { rsDecode, rsEncode } from './rs.ts';

const NSYM = 8;
function rbytes(r: () => number, n: number): Uint8Array {
  return Uint8Array.from({ length: n }, () => Math.floor(r() * 256));
}
function corrupt(r: () => number, cw: Uint8Array, e: number): Uint8Array {
  const out = cw.slice();
  const pos = new Set<number>();
  while (pos.size < e) pos.add(Math.floor(r() * cw.length));
  for (const p of pos) out[p] = out[p]! ^ (1 + Math.floor(r() * 255));
  return out;
}

describe('reed-solomon', () => {
  const r = mulberry32(42);
  it('clean round trip', () => {
    for (let i = 0; i < 200; i++) {
      const data = rbytes(r, 24);
      const cw = rsEncode(data, NSYM);
      expect(cw.length).toBe(32);
      const res = rsDecode(cw, NSYM);
      expect(res?.data).toEqual(data);
      expect(res?.corrected).toBe(0);
    }
  });
  for (let e = 1; e <= 4; e++) {
    it(`corrects ${e} errors`, () => {
      for (let t = 0; t < 500; t++) {
        const data = rbytes(r, 24);
        const res = rsDecode(corrupt(r, rsEncode(data, NSYM), e), NSYM);
        expect(res).not.toBeNull();
        expect(res!.data).toEqual(data);
        expect(res!.corrected).toBe(e);
      }
    });
  }
  for (let e = 5; e <= 8; e++) {
    it(`does not throw or return the original with ${e} errors`, () => {
      let nulls = 0, wrong = 0;
      for (let t = 0; t < 500; t++) {
        const data = rbytes(r, 24);
        const res = rsDecode(corrupt(r, rsEncode(data, NSYM), e), NSYM);
        if (res === null) nulls++;
        else {
          expect(res.data).not.toEqual(data);
          wrong++;
        }
      }
      expect(nulls + wrong).toBe(500);
    });
  }
});
