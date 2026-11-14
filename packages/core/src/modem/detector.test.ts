import { describe, expect, it } from 'vitest';
import { FRAME_AIR_LEN } from '../constants.ts';
import { ENV_NAMES } from '../envs.ts';
import { gaussian, mulberry32 } from '../util/prng.ts';
import { createDetector } from './detector.ts';
import type { Detection } from './detector.ts';
import { renderFrame } from './synth.ts';

const SR = 48_000;
const SYNC_OFFSET = Math.round((220 * SR) / 1000);

function randomBytes(rng: () => number): Uint8Array {
  const b = new Uint8Array(FRAME_AIR_LEN);
  for (let i = 0; i < b.length; i++) b[i] = Math.floor(rng() * 256);
  return b;
}

function place(frame: Float32Array, offset: number, total: number): Float32Array {
  const x = new Float32Array(total);
  x.set(frame, offset);
  return x;
}

function detectAll(x: Float32Array, env: 'quiet' | 'jungle' | 'coast' | 'city', chunk?: () => number): Detection[] {
  const d = createDetector(env, SR);
  const res: Detection[] = [];
  if (!chunk) {
    res.push(...d.push(x));
  } else {
    for (let at = 0; at < x.length; ) {
      const len = Math.min(x.length - at, chunk());
      res.push(...d.push(x.subarray(at, at + len)));
      at += len;
    }
  }
  return res;
}

function meanPower(x: Float32Array): number {
  let s = 0;
  for (const v of x) s += v * v;
  return s / x.length;
}

describe('detector', () => {
  it('finds a clean frame inside silence', () => {
    const frame = renderFrame(randomBytes(mulberry32(1)), 0, 'quiet', 'fast', SR);
    const x = place(frame, 12_345, 6 * SR);
    const det = detectAll(x, 'quiet');
    expect(det.length).toBe(1);
    expect(Math.abs(det[0]!.sample - (12_345 + SYNC_OFFSET))).toBeLessThanOrEqual(2);
    expect(det[0]!.score).toBeGreaterThan(0.9);
  });

  it('finds the frame at 0 dB SNR', () => {
    const rng = mulberry32(2);
    const frame = renderFrame(randomBytes(rng), 1, 'quiet', 'fast', SR);
    const sigma = Math.sqrt(meanPower(frame));
    const x = place(frame, 12_345, 6 * SR);
    for (let i = 0; i < x.length; i++) x[i]! += sigma * gaussian(rng);
    const det = detectAll(x, 'quiet');
    expect(det.length).toBe(1);
    expect(Math.abs(det[0]!.sample - (12_345 + SYNC_OFFSET))).toBeLessThanOrEqual(4);
  });

  it('finds nothing in 30 s of noise', () => {
    const rng = mulberry32(3);
    const x = new Float32Array(30 * SR);
    for (let i = 0; i < x.length; i++) x[i] = 0.1 * gaussian(rng);
    expect(detectAll(x, 'quiet').length).toBe(0);
  });

  it('is independent of chunking', () => {
    const rng = mulberry32(4);
    const frame = renderFrame(randomBytes(rng), 2, 'city', 'fast', SR);
    const x = place(frame, 7_777, 6 * SR);
    for (let i = 0; i < x.length; i++) x[i]! += 0.05 * gaussian(rng);
    const whole = detectAll(x, 'city');
    const chunks = detectAll(x, 'city', () => 1 + Math.floor(rng() * 5000));
    expect(chunks).toEqual(whole);
    expect(whole.length).toBe(1);
  });

  it('finds two frames close together', () => {
    const rng = mulberry32(5);
    const a = renderFrame(randomBytes(rng), 0, 'quiet', 'fast', SR);
    const b = renderFrame(randomBytes(rng), 3, 'quiet', 'fast', SR);
    const gap = Math.round(0.2 * SR);
    const x = new Float32Array(a.length + gap + b.length + 2 * SR);
    x.set(a, 1000);
    x.set(b, 1000 + a.length + gap);
    const det = detectAll(x, 'quiet');
    expect(det.length).toBe(2);
    expect(Math.abs(det[0]!.sample - (1000 + SYNC_OFFSET))).toBeLessThanOrEqual(2);
    expect(Math.abs(det[1]!.sample - (1000 + a.length + gap + SYNC_OFFSET))).toBeLessThanOrEqual(2);
  });

  for (const env of ENV_NAMES) {
    it(`works in ${env}`, () => {
      const frame = renderFrame(randomBytes(mulberry32(9)), 1, env, 'stealth', SR);
      const det = detectAll(place(frame, 5000, frame.length + 3 * SR), env);
      expect(det.length).toBe(1);
      expect(Math.abs(det[0]!.sample - (5000 + SYNC_OFFSET))).toBeLessThanOrEqual(2);
      expect(det[0]!.score).toBeGreaterThan(0.9);
    });
  }
});
