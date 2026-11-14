import { expect, it } from 'vitest';
import { mulberry32 } from './util/prng.ts';
import { bytesToSymbols, symbolsToBytes } from './symbols.ts';

it('bytes <-> symbols round trip for 4 and 5 bits', () => {
  const rng = mulberry32(5);
  for (const b of [4, 5]) {
    for (let n = 0; n < 50; n++) {
      const x = new Uint8Array(32).map(() => Math.floor(rng() * 256));
      expect(Array.from(symbolsToBytes(bytesToSymbols(x, b), b, 32))).toEqual(Array.from(x));
    }
  }
});
