import { FRAME_AIR_LEN } from '../constants.ts';
import { envPitchesHz, envSignalRange, PROFILES } from '../envs.ts';
import type { EnvName, ProfileName } from '../envs.ts';
import { bytesToSymbols, shapeFreqs, symbolPitchIndex, symbolShape } from '../symbols.ts';
import {
  frameAirtimeMs,
  INTRO_GAP_MS,
  INTRO_NOTE_MS,
  INTRO_NOTES,
  SYNC_GAP_MS,
  SYNC_START_MS,
  SYNC_SWEEP_MS,
  symbolStartMs,
  symbolsPerFrame,
} from '../timing.ts';

export interface ChirpFreqs {
  start: number;
  mid: number;
  end: number;
}

/** Number of samples for a duration, using the convention shared by synth and receiver. */
export function msToSamples(ms: number, sampleRate: number): number {
  return Math.round((ms * sampleRate) / 1000);
}

/**
 * Phase of a chirp at every sample. Phase starts at 0 and is the running sum
 * of 2*pi*f/sampleRate, with f moving start -> mid -> end linearly.
 */
export function chirpPhases(freqs: ChirpFreqs, count: number, sampleRate: number): Float64Array {
  const phase = new Float64Array(count);
  let acc = 0;
  const twoPiOverFs = (2 * Math.PI) / sampleRate;
  for (let n = 0; n < count; n++) {
    phase[n] = acc;
    const u = n / count;
    const f = u < 0.5 ? freqs.start + (freqs.mid - freqs.start) * (u / 0.5) : freqs.mid + (freqs.end - freqs.mid) * ((u - 0.5) / 0.5);
    acc += twoPiOverFs * f;
  }
  return phase;
}

/** Tukey window: raised-cosine rise over the first taper/2 of the samples, fall over the last taper/2. */
export function tukeyWindow(count: number, taper: number): Float64Array {
  const w = new Float64Array(count).fill(1);
  const edge = Math.floor((taper / 2) * count);
  for (let n = 0; n < edge; n++) {
    const v = 0.5 * (1 - Math.cos((Math.PI * n) / edge));
    w[n] = v;
    w[count - 1 - n] = v;
  }
  return w;
}

/** One chirp. Frequency goes start -> mid (first half) -> end (second half), linearly. */
export function renderChirp(
  freqs: ChirpFreqs,
  durMs: number,
  sampleRate: number,
  opts?: { taper?: number; harmonic3?: number },
): Float32Array {
  const taper = opts?.taper ?? 0.2;
  let harmonic3 = opts?.harmonic3 ?? 0;
  if (3 * Math.max(freqs.start, freqs.mid, freqs.end) > 0.45 * sampleRate) harmonic3 = 0;
  const count = msToSamples(durMs, sampleRate);
  const phase = chirpPhases(freqs, count, sampleRate);
  const win = tukeyWindow(count, taper);
  const out = new Float32Array(count);
  for (let n = 0; n < count; n++) {
    let s = Math.sin(phase[n]!);
    if (harmonic3 !== 0) s += harmonic3 * Math.sin(3 * phase[n]!);
    out[n] = s * win[n]!;
  }
  return out;
}

interface Species {
  intro: readonly [number, number, number];
  taper: number;
  harmonic3: number;
}

const SPECIES: readonly Species[] = [
  { intro: [0, 2, 4], taper: 0.2, harmonic3: 0 },
  { intro: [4, 2, 0], taper: 0.3, harmonic3: 0.1 },
  { intro: [1, 5, 3], taper: 0.15, harmonic3: 0.2 },
  { intro: [6, 3, 7], taper: 0.25, harmonic3: 0.05 },
];

const INTRO_LEVEL = 0.6;
const PEAK = 0.8;
const SEMITONE = 2 ** (1 / 12);

function addAt(dst: Float32Array, src: Float32Array, at: number, gain: number): void {
  for (let n = 0; n < src.length; n++) {
    const i = at + n;
    if (i < 0 || i >= dst.length) continue;
    dst[i]! += src[n]! * gain;
  }
}

/** Build one frame before the final peak normalisation. Returns the raw samples and the scale that brings the peak to 0.8. */
export function renderFrameUnscaled(
  air: Uint8Array,
  species: number,
  env: EnvName,
  profile: ProfileName,
  sampleRate: number,
): { raw: Float32Array; scale: number } {
  if (air.length !== FRAME_AIR_LEN) throw new RangeError(`air must be ${FRAME_AIR_LEN} bytes, got ${air.length}`);
  const p = PROFILES[profile];
  const sp = SPECIES[((species % SPECIES.length) + SPECIES.length) % SPECIES.length]!;
  const pitches = envPitchesHz(env);
  const raw = new Float32Array(msToSamples(frameAirtimeMs(p), sampleRate));

  for (let j = 0; j < INTRO_NOTES; j++) {
    const base = pitches[sp.intro[j]!]!;
    const top = base * SEMITONE;
    const note = renderChirp({ start: base, mid: (base + top) / 2, end: top }, INTRO_NOTE_MS, sampleRate, {
      taper: sp.taper,
      harmonic3: sp.harmonic3,
    });
    addAt(raw, note, msToSamples(j * (INTRO_NOTE_MS + INTRO_GAP_MS), sampleRate), INTRO_LEVEL);
  }

  const { lowHz, highHz } = envSignalRange(env);
  const up = renderChirp({ start: lowHz, mid: (lowHz + highHz) / 2, end: highHz }, SYNC_SWEEP_MS, sampleRate, { taper: 0.1 });
  const down = renderChirp({ start: highHz, mid: (lowHz + highHz) / 2, end: lowHz }, SYNC_SWEEP_MS, sampleRate, { taper: 0.1 });
  addAt(raw, up, msToSamples(SYNC_START_MS, sampleRate), 1);
  addAt(raw, down, msToSamples(SYNC_START_MS + SYNC_SWEEP_MS + SYNC_GAP_MS, sampleRate), 1);

  const symbols = bytesToSymbols(air, p.bitsPerSymbol);
  if (symbols.length !== symbolsPerFrame(p)) throw new Error('symbol count mismatch');
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i]!;
    const chirp = renderChirp(shapeFreqs(pitches[symbolPitchIndex(s)]!, symbolShape(s)), p.syllableMs, sampleRate, {
      taper: sp.taper,
      harmonic3: sp.harmonic3,
    });
    addAt(raw, chirp, msToSamples(symbolStartMs(i, p), sampleRate), 1);
  }

  let peak = 0;
  for (let n = 0; n < raw.length; n++) peak = Math.max(peak, Math.abs(raw[n]!));
  return { raw, scale: peak > 0 ? PEAK / peak : 1 };
}

export function renderFrame(air: Uint8Array, species: number, env: EnvName, profile: ProfileName, sampleRate: number): Float32Array {
  const { raw, scale } = renderFrameUnscaled(air, species, env, profile, sampleRate);
  const out = new Float32Array(raw.length);
  for (let n = 0; n < raw.length; n++) out[n] = raw[n]! * scale;
  return out;
}
