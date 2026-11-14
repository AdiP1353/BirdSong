import { expect, it } from 'vitest';
import { crc16 } from './crc16.ts';

it('check value', () => {
  expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x29b1);
});
