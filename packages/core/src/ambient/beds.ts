import { envBand } from '../envs.ts';
import type { EnvName } from '../envs.ts';
import { mulberry32 } from '../util/prng.ts';
import { biquadHighpass, biquadLowpass, loopCrossfade, pinkNoise, sine } from './dsp.ts';

const TAU = 2 * Math.PI;

function add(dst: Float32Array, src: Float32Array, gain: number): void {
  for (let i = 0; i < dst.length; i++) dst[i] = dst[i]! + src[i]! * gain;
}

function uniform(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

/** Slow random gain wobble: 1 + depth * sin at a frequency in 0.1-0.3 Hz. */
function wobble(n: number, sr: number, rng: () => number, depth: number): Float32Array {
  const f = uniform(rng, 0.1, 0.3);
  const ph = rng() * TAU;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 1 + depth * Math.sin((TAU * f * i) / sr + ph);
  return g;
}

/** Raised-cosine swell cycles, each `minS`-`maxS` seconds long. Output in [floor, 1]. */
function swellCycles(n: number, sr: number, rng: () => number, minS: number, maxS: number, floor: number): Float32Array {
  const g = new Float32Array(n);
  let pos = 0;
  while (pos < n) {
    const len = Math.max(1, Math.round(uniform(rng, minS, maxS) * sr));
    for (let i = 0; i < len && pos + i < n; i++) {
      g[pos + i] = floor + (1 - floor) * 0.5 * (1 - Math.cos((TAU * i) / len));
    }
    pos += len;
  }
  return g;
}

/** Isolated Hann-shaped swell events, one every `minS`-`maxS` seconds. */
function swellEvents(n: number, sr: number, rng: () => number, minS: number, maxS: number, widthS: number): Float32Array {
  const g = new Float32Array(n);
  let t = uniform(rng, 0, minS);
  while (t * sr < n) {
    const len = Math.round(widthS * uniform(rng, 0.7, 1.3) * sr);
    const start = Math.round(t * sr);
    for (let i = 0; i < len && start + i < n; i++) {
      g[start + i] = Math.max(g[start + i]!, 0.5 * (1 - Math.cos((TAU * i) / len)));
    }
    t += uniform(rng, minS, maxS);
  }
  return g;
}

function rawBed(env: EnvName, n: number, sr: number, rng: () => number): Float32Array {
  const out = new Float32Array(n);
  const { lowHz, highHz } = envBand(env);
  const nyq = 0.45 * sr;

  if (env === 'jungle') {
    // Rain, below the band.
    const rain = biquadLowpass(pinkNoise(n, rng), 0.6 * lowHz, sr);
    const w = wobble(n, sr, rng, 0.3);
    for (let i = 0; i < n; i++) rain[i] = rain[i]! * w[i]!;
    add(out, rain, 1);
    // Insects, above the band (omitted if they do not fit under Nyquist).
    if (1.4 * highHz < nyq) {
      const hz = Math.min(1.6 * highHz, nyq);
      const ins = new Float32Array(n);
      let t = uniform(rng, 0.2, 1.5);
      while (t * sr < n) {
        const len = Math.round(uniform(rng, 0.3, 2) * sr);
        const start = Math.round(t * sr);
        const am = uniform(rng, 30, 60);
        const tone = sine(Math.min(len, n - start), hz, sr, rng() * TAU);
        for (let i = 0; i < tone.length; i++) {
          const edge = Math.min(1, i / (0.02 * sr), (tone.length - i) / (0.02 * sr));
          ins[start + i] = tone[i]! * (0.5 + 0.5 * Math.sin((TAU * am * i) / sr)) * edge;
        }
        t += len / sr + uniform(rng, 1, 4);
      }
      add(out, biquadHighpass(ins, 1.4 * highHz, sr), 0.15);
    }
  } else if (env === 'coast') {
    const swell = swellCycles(n, sr, rng, 6, 10, 0.15);
    const surf = biquadLowpass(pinkNoise(n, rng), 0.6 * lowHz, sr);
    for (let i = 0; i < n; i++) surf[i] = surf[i]! * swell[i]!;
    add(out, surf, 1);
    if (1.6 * highHz < nyq) {
      const white = new Float32Array(n);
      for (let i = 0; i < n; i++) white[i] = rng() * 2 - 1;
      const spray = biquadHighpass(white, 1.6 * highHz, sr);
      for (let i = 0; i < n; i++) spray[i] = spray[i]! * swell[i]!;
      add(out, spray, 0.05); // roughly -12 dB against the surf
    }
    if (1.8 * highHz < nyq) {
      const top = Math.min(2.6 * highHz, nyq);
      const bottom = 1.8 * highHz;
      const gulls = new Float32Array(n);
      let t = uniform(rng, 1, 4);
      while (t * sr < n) {
        const len = Math.round(uniform(rng, 0.3, 0.6) * sr);
        const start = Math.round(t * sr);
        let phase = 0;
        for (let i = 0; i < len && start + i < n; i++) {
          const f = top + (bottom - top) * (i / len);
          phase += (TAU * f) / sr;
          gulls[start + i] = Math.sin(phase) * Math.sin((Math.PI * i) / len);
        }
        t += len / sr + uniform(rng, 4, 12);
      }
      add(out, biquadHighpass(gulls, 1.4 * highHz, sr), 0.1);
    }
  } else if (env === 'city') {
    add(out, biquadLowpass(pinkNoise(n, rng), 300, sr), 0.8);
    const amps = [1, 0.5, 0.25];
    for (let h = 0; h < 3; h++) add(out, sine(n, 50 * (h + 1), sr, rng() * TAU), 0.05 * amps[h]!);
    const traffic = biquadLowpass(pinkNoise(n, rng), 0.6 * lowHz, sr);
    const ev = swellEvents(n, sr, rng, 5, 15, 4);
    for (let i = 0; i < n; i++) traffic[i] = traffic[i]! * ev[i]!;
    add(out, traffic, 1.2);
  }
  return out;
}

export function renderAmbient(env: EnvName, seconds: number, sampleRate: number, seed: number): Float32Array {
  const length = Math.round(seconds * sampleRate);
  if (env === 'quiet') return new Float32Array(length);
  const rng = mulberry32(seed);
  const raw = rawBed(env, length + sampleRate, sampleRate, rng);
  const y = loopCrossfade(raw, sampleRate);
  let peak = 0;
  for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]!));
  if (peak > 0) for (let i = 0; i < y.length; i++) y[i] = (y[i]! * 0.5) / peak;
  return y;
}
