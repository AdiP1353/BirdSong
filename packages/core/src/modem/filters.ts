/** Streaming band-pass: two 2nd-order high-pass and two 2nd-order low-pass biquads (RBJ cookbook, Q = 0.7071). */

export interface Bandpass {
  process(input: Float32Array): Float32Array;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  z1: number;
  z2: number;
}

const Q = Math.SQRT1_2;

function makeBiquad(kind: 'hp' | 'lp', fc: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const a0 = 1 + alpha;
  let b0: number;
  let b1: number;
  let b2: number;
  if (kind === 'hp') {
    b0 = (1 + cosw) / 2;
    b1 = -(1 + cosw);
    b2 = (1 + cosw) / 2;
  } else {
    b0 = (1 - cosw) / 2;
    b1 = 1 - cosw;
    b2 = (1 - cosw) / 2;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cosw) / a0, a2: (1 - alpha) / a0, z1: 0, z2: 0 };
}

export function createBandpass(lowHz: number, highHz: number, sampleRate: number): Bandpass {
  const hi = Math.min(highHz, 0.45 * sampleRate);
  const stages: Biquad[] = [
    makeBiquad('hp', lowHz, sampleRate),
    makeBiquad('hp', lowHz, sampleRate),
    makeBiquad('lp', hi, sampleRate),
    makeBiquad('lp', hi, sampleRate),
  ];
  return {
    process(input: Float32Array): Float32Array {
      const out = new Float32Array(input.length);
      for (let n = 0; n < input.length; n++) {
        let v = input[n]!;
        for (let s = 0; s < stages.length; s++) {
          const st = stages[s]!;
          // transposed direct form II
          const y = st.b0 * v + st.z1;
          st.z1 = st.b1 * v - st.a1 * y + st.z2;
          st.z2 = st.b2 * v - st.a2 * y;
          v = y;
        }
        out[n] = v;
      }
      return out;
    },
  };
}
