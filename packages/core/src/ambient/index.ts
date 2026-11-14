import type { EnvName } from '../envs.ts';

/** Recommended ambient playback gain relative to the data signal. Final values; plan 006 keeps them. */
export const AMBIENT_LEVEL: Record<EnvName, number> = { quiet: 0, jungle: 0.5, coast: 0.7, city: 0.6 };

/** A loopable ambient bed whose energy lies outside the environment's signal band. */
export function renderAmbient(_env: EnvName, _seconds: number, _sampleRate: number, _seed: number): Float32Array {
  throw new Error('not implemented: plan 006');
}
