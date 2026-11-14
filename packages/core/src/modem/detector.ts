import FFT from 'fft.js';
import type { EnvName } from '../envs.ts';
import { buildSyncTemplate } from './templates.ts';

export interface Detection {
  /** Absolute sample index (in the stream given to the detector) where the sync starts. */
  sample: number;
  /** Normalised correlation, 0..1. */
  score: number;
}

export interface Detector {
  /** Feed samples. Returns the detections that became final, in increasing sample order. */
  push(x: Float32Array): Detection[];
  reset(): void;
  /** Length of the sync template in samples. */
  readonly syncLength: number;
}

export const DEFAULT_SYNC_THRESHOLD = 0.25;

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Streaming cross-correlation against the sync template (FFT, overlap-save).
 * score = |sum x[m+n] conj(t[n])| / sqrt(Et/2 * sum x[m+n]^2).
 */
export function createDetector(env: EnvName, sampleRate: number, threshold: number = DEFAULT_SYNC_THRESHOLD): Detector {
  const tpl = buildSyncTemplate(env, sampleRate);
  const L = tpl.re.length;
  const N = nextPow2(4 * L);
  const step = N - L + 1; // number of lags per window
  const fft = new FFT(N);

  // conj(T) with T = FFT of the zero-padded template
  const tIn = new Float64Array(2 * N);
  for (let n = 0; n < L; n++) {
    tIn[2 * n] = tpl.re[n]!;
    tIn[2 * n + 1] = tpl.im[n]!;
  }
  const T = new Float64Array(2 * N);
  fft.transform(T, tIn);
  for (let k = 0; k < N; k++) T[2 * k + 1] = -T[2 * k + 1]!;

  const xin = new Float64Array(2 * N);
  const X = new Float64Array(2 * N);
  const y = new Float64Array(2 * N);
  const prefix = new Float64Array(N + 1);
  const halfEt = tpl.energy / 2;
  const silence = 1e-9 * L;

  let buf = new Float32Array(2 * N);
  let len = 0;
  let base = 0; // absolute index of buf[0]

  let candPos = -1;
  let candScore = 0;
  let out: Detection[] = [];

  function emitCandidate(): void {
    if (candPos >= 0) out.push({ sample: candPos, score: candScore });
    candPos = -1;
    candScore = 0;
  }

  function processWindow(): void {
    for (let n = 0; n < N; n++) {
      xin[2 * n] = buf[n]!;
      xin[2 * n + 1] = 0;
    }
    fft.transform(X, xin);
    for (let k = 0; k < N; k++) {
      const xr = X[2 * k]!;
      const xi = X[2 * k + 1]!;
      const tr = T[2 * k]!;
      const ti = T[2 * k + 1]!;
      X[2 * k] = xr * tr - xi * ti;
      X[2 * k + 1] = xr * ti + xi * tr;
    }
    fft.inverseTransform(y, X);
    prefix[0] = 0;
    for (let n = 0; n < N; n++) prefix[n + 1] = prefix[n]! + buf[n]! * buf[n]!;

    for (let m = 0; m < step; m++) {
      const pos = base + m;
      if (candPos >= 0 && pos - candPos > L) emitCandidate();
      const ex = prefix[m + L]! - prefix[m]!;
      if (ex < silence) continue;
      const re = y[2 * m]!;
      const im = y[2 * m + 1]!;
      const rho = Math.sqrt(re * re + im * im) / Math.sqrt(halfEt * ex);
      if (rho < threshold) continue;
      if (candPos < 0 || rho > candScore) {
        candPos = pos;
        candScore = rho;
      }
    }
  }

  return {
    syncLength: L,
    push(x: Float32Array): Detection[] {
      let at = 0;
      while (at < x.length) {
        // top up the buffer to at most N samples, process when full
        if (len + (x.length - at) > buf.length) {
          const bigger = new Float32Array(Math.max(buf.length * 2, len + (x.length - at)));
          bigger.set(buf.subarray(0, len));
          buf = bigger;
        }
        const take = Math.min(x.length - at, N - len);
        buf.set(x.subarray(at, at + take), len);
        len += take;
        at += take;
        if (len >= N) {
          processWindow();
          buf.copyWithin(0, step, len);
          len -= step;
          base += step;
        }
      }
      const res = out;
      out = [];
      return res;
    },
    reset(): void {
      len = 0;
      base = 0;
      candPos = -1;
      candScore = 0;
      out = [];
    },
  };
}
