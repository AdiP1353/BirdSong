import { envPitchesHz, envSignalRange, PROFILES } from '../envs.ts';
import type { EnvName, ProfileName } from '../envs.ts';
import { shapeFreqs, symbolPitchIndex, symbolShape } from '../symbols.ts';
import { SYNC_GAP_MS, SYNC_MS, SYNC_SWEEP_MS } from '../timing.ts';
import { chirpPhases, msToSamples, tukeyWindow } from './synth.ts';
import type { ChirpFreqs } from './synth.ts';

/** Analytic (complex) version of a chirp. */
export interface ComplexTemplate {
  re: Float32Array;
  im: Float32Array;
  /** Sum of |t|^2. */
  energy: number;
}

export interface SymbolTemplates {
  /** Index = symbol value. */
  templates: ComplexTemplate[];
}

/** Default Tukey taper of the data templates. Must match the synth default. */
export const TEMPLATE_TAPER = 0.2;
export const SYNC_TAPER = 0.1;

function fromParts(re: Float32Array, im: Float32Array): ComplexTemplate {
  let energy = 0;
  for (let n = 0; n < re.length; n++) energy += re[n]! * re[n]! + im[n]! * im[n]!;
  return { re, im, energy };
}

/** t[n] = w[n] * exp(j * phase[n]) with the same phase and window as renderChirp (no harmonic). */
export function buildChirpTemplate(freqs: ChirpFreqs, durMs: number, sampleRate: number, taper: number = TEMPLATE_TAPER): ComplexTemplate {
  const count = msToSamples(durMs, sampleRate);
  const phase = chirpPhases(freqs, count, sampleRate);
  const win = tukeyWindow(count, taper);
  const re = new Float32Array(count);
  const im = new Float32Array(count);
  for (let n = 0; n < count; n++) {
    re[n] = win[n]! * Math.cos(phase[n]!);
    im[n] = win[n]! * Math.sin(phase[n]!);
  }
  return fromParts(re, im);
}

export function buildSymbolTemplates(env: EnvName, profile: ProfileName, sampleRate: number, taper: number = TEMPLATE_TAPER): SymbolTemplates {
  const p = PROFILES[profile];
  const pitches = envPitchesHz(env);
  const count = 1 << p.bitsPerSymbol;
  const templates: ComplexTemplate[] = [];
  for (let s = 0; s < count; s++) {
    templates.push(buildChirpTemplate(shapeFreqs(pitches[symbolPitchIndex(s)]!, symbolShape(s)), p.syllableMs, sampleRate, taper));
  }
  return { templates };
}

export interface SyncTemplate extends ComplexTemplate {
  /** Sample offsets and lengths of the two sweeps inside the template. */
  upLen: number;
  downStart: number;
  downLen: number;
}

/** Up-sweep, 20 ms of zeros, down-sweep. Length is SYNC_MS. */
export function buildSyncTemplate(env: EnvName, sampleRate: number): SyncTemplate {
  const { lowHz, highHz } = envSignalRange(env);
  const mid = (lowHz + highHz) / 2;
  const up = buildChirpTemplate({ start: lowHz, mid, end: highHz }, SYNC_SWEEP_MS, sampleRate, SYNC_TAPER);
  const down = buildChirpTemplate({ start: highHz, mid, end: lowHz }, SYNC_SWEEP_MS, sampleRate, SYNC_TAPER);
  const total = msToSamples(SYNC_MS, sampleRate);
  const re = new Float32Array(total);
  const im = new Float32Array(total);
  const downStart = Math.min(total - down.re.length, msToSamples(SYNC_SWEEP_MS + SYNC_GAP_MS, sampleRate));
  re.set(up.re, 0);
  im.set(up.im, 0);
  re.set(down.re, downStart);
  im.set(down.im, downStart);
  const t = fromParts(re, im);
  return { ...t, upLen: up.re.length, downStart, downLen: down.re.length };
}
