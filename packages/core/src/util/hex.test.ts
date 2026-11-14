import { expect, it } from 'vitest';
import { fromHex, toHex } from './hex.ts';

it('hex round trips', () => {
  const b = Uint8Array.from([0, 1, 15, 16, 255, 128]);
  expect(toHex(b)).toBe('00010f10ff80');
  expect(Array.from(fromHex(toHex(b)))).toEqual(Array.from(b));
});
