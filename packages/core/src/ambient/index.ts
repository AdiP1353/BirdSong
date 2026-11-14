import type { EnvName } from '../envs.ts';

/** Recommended ambient playback gain relative to the data signal. Final values; plan 006 keeps them. */
export const AMBIENT_LEVEL: Record<EnvName, number> = { quiet: 0, jungle: 0.5, coast: 0.7, city: 0.6 };

export { renderAmbient } from './beds.ts';
