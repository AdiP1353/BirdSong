import { expect, it } from 'vitest';
import { charCount } from './counter.ts';

it('counts an emoji as one character', () => {
  expect(charCount('hi🐦')).toBe(3);
  expect(charCount('')).toBe(0);
});
