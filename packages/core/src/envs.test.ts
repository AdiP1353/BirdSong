import { expect, it } from 'vitest';
import { ENV_NAMES, envBand, envPitchesHz, midiToHz } from './envs.ts';

it('every environment is well formed', () => {
  for (const env of ENV_NAMES) {
    expect(envBand(env).highHz).toBeLessThan(8000);
    const p = envPitchesHz(env);
    expect(p).toHaveLength(8);
    for (let i = 1; i < p.length; i++) expect(p[i]!).toBeGreaterThan(p[i - 1]!);
  }
  expect(midiToHz(69)).toBe(440);
});
