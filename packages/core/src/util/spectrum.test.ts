import { describe, expect, it } from 'vitest';
import { createSpectrum } from './spectrum.ts';

describe('createSpectrum', () => {
  it('puts a sine in its bin at about its amplitude, using the newest samples', () => {
    const spec = createSpectrum(1024);
    const x = Float32Array.from({ length: 3000 }, (_, i) => (i < 1500 ? 0 : 0.5 * Math.sin((2 * Math.PI * 3000 * i) / 48000)));
    const m = spec(x);
    let peak = 0;
    for (let k = 1; k < m.length; k++) if (m[k]! > m[peak]!) peak = k;
    expect(peak).toBe(64); // 3000 Hz / (48000 / 1024)
    expect(m[peak]!).toBeGreaterThan(0.4);
    expect(m[peak]!).toBeLessThan(0.6);
    expect(m[200]!).toBeLessThan(0.01);
    expect(spec(new Float32Array(10)).every((v) => v === 0)).toBe(true);
  });
});
