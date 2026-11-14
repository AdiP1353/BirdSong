import FFT from 'fft.js';
import { gaussian } from '../util/prng.ts';
import { renderChirp } from './synth.ts';

/** First and last non-zero sample (inclusive start, exclusive end). Returns [0, length) when everything is zero. */
function nonZeroSpan(x: Float32Array): [number, number] {
  let first = 0;
  while (first < x.length && x[first] === 0) first++;
  let last = x.length;
  while (last > first && x[last - 1] === 0) last--;
  return first >= last ? [0, x.length] : [first, last];
}

function spanRms(x: Float32Array): number {
  const [a, b] = nonZeroSpan(x);
  let s = 0;
  for (let i = a; i < b; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, b - a));
}

function rmsOf(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
}

/** Add white Gaussian noise. snrDb is measured against the mean power of `signal`'s non-zero span. */
export function addNoise(signal: Float32Array, snrDb: number, rng: () => number): Float32Array {
  const sigma = spanRms(signal) / 10 ** (snrDb / 20);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i]! + sigma * gaussian(rng);
  return out;
}

/** Synthetic room: direct path + exponentially decaying noise tail. */
export function makeReverbIr(rt60Ms: number, directToReverbDb: number, sampleRate: number, rng: () => number): Float32Array {
  const len = Math.max(2, Math.round((rt60Ms * sampleRate) / 1000));
  const decay = 6.908 / ((rt60Ms * sampleRate) / 1000);
  const ir = new Float64Array(len + 1);
  let sum = 0;
  for (let n = 1; n <= len; n++) {
    ir[n] = gaussian(rng) * Math.exp(-decay * n);
    sum += ir[n]! * ir[n]!;
  }
  const g = Math.sqrt(10 ** (-directToReverbDb / 10) / sum);
  const out = new Float32Array(len + 1);
  out[0] = 1;
  for (let n = 1; n <= len; n++) out[n] = g * ir[n]!;
  return out;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Full linear convolution (length x + ir - 1), FFT overlap-add. */
export function convolve(x: Float32Array, ir: Float32Array): Float32Array {
  const out = new Float32Array(x.length + ir.length - 1);
  if (x.length === 0) return out;
  const size = Math.max(1024, nextPow2(ir.length * 4));
  const block = size - ir.length + 1;
  const fft = new FFT(size);
  const hin = new Float64Array(2 * size);
  for (let i = 0; i < ir.length; i++) hin[2 * i] = ir[i]!;
  const H = new Float64Array(2 * size);
  fft.transform(H, hin);
  const xin = new Float64Array(2 * size);
  const X = new Float64Array(2 * size);
  const y = new Float64Array(2 * size);
  const acc = new Float64Array(out.length);
  for (let start = 0; start < x.length; start += block) {
    const n = Math.min(block, x.length - start);
    xin.fill(0);
    for (let i = 0; i < n; i++) xin[2 * i] = x[start + i]!;
    fft.transform(X, xin);
    for (let k = 0; k < size; k++) {
      const xr = X[2 * k]!;
      const xi = X[2 * k + 1]!;
      const hr = H[2 * k]!;
      const hi = H[2 * k + 1]!;
      X[2 * k] = xr * hr - xi * hi;
      X[2 * k + 1] = xr * hi + xi * hr;
    }
    fft.inverseTransform(y, X);
    const m = Math.min(size, out.length - start);
    for (let i = 0; i < m; i++) acc[start + i]! += y[2 * i]!;
  }
  for (let i = 0; i < out.length; i++) out[i] = acc[i]!;
  return out;
}

/**
 * Random bird-like chirps inside [lowHz, highHz]: 30-120 ms long, 50-400 ms apart,
 * random direction, each one sweeping between 2% and 30% of its start frequency
 * (real bird syllables are narrow; none of them spans the whole band).
 * Peak amplitude is about 1; scale it with mixAt or by hand.
 */
export function makeBirdNoise(seconds: number, lowHz: number, highHz: number, sampleRate: number, rng: () => number): Float32Array {
  const total = Math.round(seconds * sampleRate);
  const out = new Float32Array(total);
  let t = Math.round(rng() * 0.2 * sampleRate);
  while (t < total) {
    const durMs = 30 + rng() * 90;
    const f0 = lowHz + rng() * (highHz - lowHz);
    const frac = 0.02 + rng() * 0.28;
    const dir = rng() < 0.5 ? -1 : 1;
    const f1 = Math.min(highHz, Math.max(lowHz, f0 * (1 + dir * frac)));
    const amp = 0.5 + 0.5 * rng();
    const chirp = renderChirp({ start: f0, mid: (f0 + f1) / 2, end: f1 }, durMs, sampleRate, { taper: 0.3 });
    for (let i = 0; i < chirp.length && t + i < total; i++) out[t + i]! += amp * chirp[i]!;
    t += chirp.length + Math.round(((50 + rng() * 350) * sampleRate) / 1000);
  }
  return out;
}

/** Scale `b` so that its RMS is `db` relative to the RMS of `a`'s non-zero span, then add. Result has the length of `a`. */
export function mixAt(a: Float32Array, b: Float32Array, db: number): Float32Array {
  const target = spanRms(a) * 10 ** (db / 20);
  const rb = rmsOf(b);
  const scale = rb > 0 ? target / rb : 0;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! + (i < b.length ? scale * b[i]! : 0);
  return out;
}
