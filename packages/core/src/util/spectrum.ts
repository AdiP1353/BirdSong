import FFT from 'fft.js';

/**
 * Magnitude spectrum of the last `size` samples (Hann window), for drawing spectrograms from raw PCM without
 * an AudioContext. `size` must be a power of two. Returns size/2 magnitudes, scaled so a full-scale sine is ~1.
 */
export function createSpectrum(size: number): (samples: Float32Array) => Float32Array {
  const fft = new FFT(size);
  const input = fft.createComplexArray() as number[];
  const output = fft.createComplexArray() as number[];
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / size);
  const mags = new Float32Array(size / 2);
  return (samples) => {
    const off = samples.length - size;
    for (let i = 0; i < size; i++) {
      input[2 * i] = off + i >= 0 ? samples[off + i]! * win[i]! : 0;
      input[2 * i + 1] = 0;
    }
    fft.transform(output, input);
    for (let k = 0; k < size / 2; k++) mags[k] = (4 / size) * Math.hypot(output[2 * k]!, output[2 * k + 1]!);
    return mags;
  };
}
