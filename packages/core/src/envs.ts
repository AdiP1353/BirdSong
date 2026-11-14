import { SWEEP_SEMITONES } from './constants.ts';

export type EnvName = 'quiet' | 'jungle' | 'coast' | 'city';
export type ProfileName = 'stealth' | 'fast';

export interface Profile {
  name: ProfileName;
  syllableMs: number;
  gapMs: number;
  /** Number of chirp shapes in use: 2 = up/down, 4 = up/down/hook/dip. */
  shapes: 2 | 4;
  /** 3 bits of pitch + log2(shapes) bits of shape. */
  bitsPerSymbol: 4 | 5;
  /** Insert a pause after every `phraseLen` syllables. 0 = never. */
  phraseLen: number;
  phrasePauseMs: number;
}

export const PROFILES: Record<ProfileName, Profile> = {
  stealth: { name: 'stealth', syllableMs: 90, gapMs: 30, shapes: 2, bitsPerSymbol: 4, phraseLen: 8, phrasePauseMs: 120 },
  fast: { name: 'fast', syllableMs: 40, gapMs: 10, shapes: 4, bitsPerSymbol: 5, phraseLen: 0, phrasePauseMs: 0 },
};

export interface EnvProfile {
  name: EnvName;
  label: string;
  /** Musical key, for display. */
  key: string;
  /** The 8 base pitches as MIDI note numbers, ascending. */
  midi: readonly number[];
  defaultProfile: ProfileName;
  theme: { bg: string; fg: string; accent: string };
}

export const ENVS: Record<EnvName, EnvProfile> = {
  quiet: {
    name: 'quiet', label: 'Quiet room', key: 'C major',
    midi: [96, 98, 100, 101, 103, 105, 107, 108],
    defaultProfile: 'fast',
    theme: { bg: '#14161a', fg: '#e8e8e8', accent: '#9ad1ff' },
  },
  jungle: {
    name: 'jungle', label: 'Jungle', key: 'A major pentatonic',
    midi: [97, 100, 102, 105, 107, 109, 112, 114],
    defaultProfile: 'stealth',
    theme: { bg: '#0d1f14', fg: '#e3f5e1', accent: '#7be07b' },
  },
  coast: {
    name: 'coast', label: 'Coast', key: 'D mixolydian',
    midi: [86, 88, 90, 91, 93, 95, 96, 98],
    defaultProfile: 'stealth',
    theme: { bg: '#0c1c2b', fg: '#e6f2fb', accent: '#5cc8e8' },
  },
  city: {
    name: 'city', label: 'City', key: 'E minor pentatonic',
    midi: [95, 98, 100, 103, 105, 107, 110, 112],
    defaultProfile: 'fast',
    theme: { bg: '#1c1a22', fg: '#eeeaf5', accent: '#f0b35c' },
  },
};

export const ENV_NAMES: readonly EnvName[] = ['quiet', 'jungle', 'coast', 'city'];
export const PROFILE_NAMES: readonly ProfileName[] = ['stealth', 'fast'];

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** The 8 base pitches of an environment in Hz, ascending. */
export function envPitchesHz(env: EnvName): number[] {
  return ENVS[env].midi.map(midiToHz);
}

/** Ratio between the top and bottom of one data chirp. */
export const SWEEP_RATIO = 2 ** (SWEEP_SEMITONES / 12);

/** Lowest and highest frequency any signal of this environment uses. */
export function envSignalRange(env: EnvName): { lowHz: number; highHz: number } {
  const p = envPitchesHz(env);
  return { lowHz: p[0]!, highHz: p[p.length - 1]! * SWEEP_RATIO };
}

/** Receiver pass band: the signal range with a 10% margin on both sides. */
export function envBand(env: EnvName): { lowHz: number; highHz: number } {
  const r = envSignalRange(env);
  return { lowHz: r.lowHz * 0.9, highHz: r.highHz * 1.1 };
}
