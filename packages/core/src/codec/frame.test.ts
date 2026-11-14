import { describe, expect, it } from 'vitest';
import type { Frame } from '../types.ts';
import { mulberry32 } from '../util/prng.ts';
import { decodeAirFrame, encodeAirFrame } from './frame.ts';

const r = mulberry32(7);
const ri = (n: number) => Math.floor(r() * n);
function randomFrame(): Frame {
  return {
    netTag: ri(256), msgId: ri(65536), k: 1 + ri(15), hop: ri(16), seed: ri(255), sender: ri(256),
    payload: Uint8Array.from({ length: 16 }, () => ri(256)),
  };
}
function corrupt(air: Uint8Array, e: number): Uint8Array {
  const out = air.slice();
  const pos = new Set<number>();
  while (pos.size < e) pos.add(ri(out.length));
  for (const p of pos) out[p] = out[p]! ^ (1 + ri(255));
  return out;
}

describe('air frame', () => {
  it('round trips', () => {
    for (let i = 0; i < 200; i++) {
      const f = randomFrame();
      const air = encodeAirFrame(f);
      expect(air.length).toBe(32);
      const d = decodeAirFrame(air);
      expect(d?.frame).toEqual(f);
      expect(d?.corrected).toBe(0);
    }
  });
  it('corrects 1..4 byte errors', () => {
    for (let i = 0; i < 200; i++) {
      const f = randomFrame();
      const d = decodeAirFrame(corrupt(encodeAirFrame(f), 1 + ri(4)));
      expect(d?.frame).toEqual(f);
    }
  });
  it('never yields a different frame with 6 errors', () => {
    for (let i = 0; i < 2000; i++) {
      const f = randomFrame();
      const d = decodeAirFrame(corrupt(encodeAirFrame(f), 6));
      if (d) expect(d.frame).toEqual(f);
    }
  });
  it('rejects bad length', () => {
    expect(decodeAirFrame(new Uint8Array(31))).toBeNull();
  });
  it('out-of-range fields throw', () => {
    const f = randomFrame();
    expect(() => encodeAirFrame({ ...f, k: 0 })).toThrow(RangeError);
    expect(() => encodeAirFrame({ ...f, k: 16 })).toThrow(RangeError);
    expect(() => encodeAirFrame({ ...f, hop: 16 })).toThrow(RangeError);
    expect(() => encodeAirFrame({ ...f, seed: 255 })).toThrow(RangeError);
    expect(() => encodeAirFrame({ ...f, netTag: 256 })).toThrow(RangeError);
    expect(() => encodeAirFrame({ ...f, sender: -1 })).toThrow(RangeError);
    expect(() => encodeAirFrame({ ...f, msgId: 65536 })).toThrow(RangeError);
    expect(() => encodeAirFrame({ ...f, payload: new Uint8Array(15) })).toThrow(RangeError);
  });
});
