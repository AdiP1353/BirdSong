/** Small DSP helpers for the ambient beds. Self-contained: no imports from modem/. */

export function onePoleLowpass(x: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  const y = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += a * (x[i]! - s);
    y[i] = s;
  }
  return y;
}

export function onePoleHighpass(x: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  const lp = onePoleLowpass(x, cutoffHz, sampleRate);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i]! - lp[i]!;
  return y;
}

const Q = 0.7071;

function biquad(x: Float32Array, cutoffHz: number, sampleRate: number, high: boolean): Float32Array {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  const a1 = (-2 * cosw) / a0;
  const a2 = (1 - alpha) / a0;
  const b0 = (high ? (1 + cosw) / 2 : (1 - cosw) / 2) / a0;
  const b1 = (high ? -(1 + cosw) : 1 - cosw) / a0;
  const b2 = b0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** 4th-order (two cascaded RBJ biquads, Q 0.7071) lowpass. */
export function biquadLowpass(x: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  return biquad(biquad(x, cutoffHz, sampleRate, false), cutoffHz, sampleRate, false);
}

/** 4th-order (two cascaded RBJ biquads, Q 0.7071) highpass. */
export function biquadHighpass(x: Float32Array, cutoffHz: number, sampleRate: number): Float32Array {
  return biquad(biquad(x, cutoffHz, sampleRate, true), cutoffHz, sampleRate, true);
}

/** Pink noise, Paul Kellet's refined method. Roughly unit-scale output. */
export function pinkNoise(n: number, rng: () => number): Float32Array {
  const y = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    y[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return y;
}

export function sine(n: number, hz: number, sampleRate: number, phase = 0): Float32Array {
  const y = new Float32Array(n);
  const w = (2 * Math.PI * hz) / sampleRate;
  for (let i = 0; i < n; i++) y[i] = Math.sin(w * i + phase);
  return y;
}

/**
 * Returns `x.length - fadeSamples` samples that loop without a click: the head
 * is crossfaded with the extra tail x[n..], so y[0] continues from y[n-1].
 */
export function loopCrossfade(x: Float32Array, fadeSamples: number): Float32Array {
  const n = x.length - fadeSamples;
  if (fadeSamples <= 0 || n <= 0) return x.slice();
  const y = x.slice(0, n);
  const f = Math.min(fadeSamples, n);
  for (let i = 0; i < f; i++) {
    const t = i / fadeSamples;
    y[i] = x[i]! * t + x[n + i]! * (1 - t);
  }
  return y;
}
