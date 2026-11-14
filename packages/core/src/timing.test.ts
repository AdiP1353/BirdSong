import { expect, it } from 'vitest';
import { PROFILES } from './envs.ts';
import { frameAirtimeMs, symbolsPerFrame } from './timing.ts';

it('frame airtimes and symbol counts', () => {
  expect(frameAirtimeMs(PROFILES.stealth)).toBe(8910);
  expect(frameAirtimeMs(PROFILES.fast)).toBe(3010);
  expect(symbolsPerFrame(PROFILES.stealth)).toBe(64);
  expect(symbolsPerFrame(PROFILES.fast)).toBe(52);
});
