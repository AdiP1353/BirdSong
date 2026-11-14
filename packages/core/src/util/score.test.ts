import { expect, it } from 'vitest';
import { frameNotes } from './score.ts';

it('frameNotes gives the expected note counts and first start', () => {
  const air = new Uint8Array(32).map((_, i) => (i * 37) & 255);
  expect(frameNotes(air, 'quiet', 'stealth')).toHaveLength(64);
  const fast = frameNotes(air, 'quiet', 'fast');
  expect(fast).toHaveLength(52);
  expect(fast[0]!.startMs).toBe(400);
});
