import { describe, expect, it } from 'vitest';
import { FRAME_AIR_LEN } from '../constants.ts';
import { ENV_NAMES, PROFILE_NAMES } from '../envs.ts';
import type { EnvName, ProfileName } from '../envs.ts';
import type { RxMeta } from '../types.ts';
import { gaussian, mulberry32 } from '../util/prng.ts';
import { createModem } from './index.ts';

function randomBytes(rng: () => number): Uint8Array {
  const b = new Uint8Array(FRAME_AIR_LEN);
  for (let i = 0; i < b.length; i++) b[i] = Math.floor(rng() * 256);
  return b;
}

function withSilence(frame: Float32Array, lead: number, trail: number): Float32Array {
  const x = new Float32Array(lead + frame.length + trail);
  x.set(frame, lead);
  return x;
}

interface Got {
  air: Uint8Array;
  meta: RxMeta;
}

function listen(m: ReturnType<typeof createModem>): Got[] {
  const got: Got[] = [];
  m.onFrame((air, meta) => got.push({ air: air.slice(), meta }));
  return got;
}

function roundTrip(env: EnvName, profile: ProfileName, species: number, sampleRate: number, seed: number): void {
  const rng = mulberry32(seed);
  const air = randomBytes(rng);
  const m = createModem({ sampleRate, env, profile });
  const got = listen(m);
  const x = withSilence(m.encode(air, species), Math.round(0.5 * sampleRate), Math.round(1 * sampleRate));
  m.push(x);
  expect(got.length).toBe(1);
  expect(Array.from(got[0]!.air)).toEqual(Array.from(air));
  expect(got[0]!.meta.sync).toBeGreaterThan(0.9);
  expect(got[0]!.meta.confidence).toBeGreaterThan(0.3);
}

describe('modem', () => {
  it('clean round trip: 4 envs x 2 profiles x 4 species at 48000', () => {
    let seed = 1000;
    for (const env of ENV_NAMES) {
      for (const profile of PROFILE_NAMES) {
        for (let species = 0; species < 4; species++) roundTrip(env, profile, species, 48_000, seed++);
      }
    }
  });

  it('works at 44100 (quiet) and 8000 (coast)', () => {
    for (const profile of PROFILE_NAMES) {
      roundTrip('quiet', profile, 1, 44_100, 2000);
      roundTrip('coast', profile, 2, 8_000, 2001);
    }
  });

  it('throws RangeError when the band does not fit the sample rate', () => {
    expect(() => createModem({ sampleRate: 8_000, env: 'jungle', profile: 'fast' })).toThrow(RangeError);
    expect(() => createModem({ sampleRate: 8_000, env: 'quiet', profile: 'fast' })).toThrow(RangeError);
  });

  it('is independent of chunk size', () => {
    const rng = mulberry32(3000);
    const air = randomBytes(rng);
    const a = createModem({ sampleRate: 48_000, env: 'city', profile: 'fast' });
    const b = createModem({ sampleRate: 48_000, env: 'city', profile: 'fast' });
    const ga = listen(a);
    const gb = listen(b);
    const x = withSilence(a.encode(air, 0), 20_000, 3 * 48_000);
    for (let i = 0; i < x.length; i++) x[i]! += 0.01 * gaussian(rng);
    a.push(x);
    for (let at = 0; at < x.length; ) {
      const len = Math.min(x.length - at, 1 + Math.floor(rng() * 4096));
      b.push(x.subarray(at, at + len));
      at += len;
    }
    expect(ga.length).toBe(1);
    expect(gb.length).toBe(1);
    expect(Array.from(gb[0]!.air)).toEqual(Array.from(ga[0]!.air));
    expect(gb[0]!.meta.startSample).toBe(ga[0]!.meta.startSample);
    expect(Array.from(gb[0]!.air)).toEqual(Array.from(air));
  });

  it('busy() reacts to the start of a frame and falls quiet afterwards', () => {
    const sr = 48_000;
    const rng = mulberry32(4000);
    const air = randomBytes(rng);
    const m = createModem({ sampleRate: sr, env: 'quiet', profile: 'fast' });
    const got = listen(m);
    const frame = m.encode(air, 2);
    const lead = 2 * sr;
    const total = lead + frame.length + sr;
    const x = new Float32Array(total);
    x.set(frame, lead);
    for (let i = 0; i < total; i++) x[i]! += 0.005 * gaussian(rng);
    const chunk = Math.round(0.01 * sr);
    let busyBefore = false;
    let firstBusyAfterStart = -1;
    let droppedWhileFrame = false;
    let busyAt400 = true;
    for (let at = 0; at + chunk <= total; at += chunk) {
      m.push(x.subarray(at, at + chunk));
      const now = at + chunk;
      const b = m.busy();
      if (now <= lead && b) busyBefore = true;
      if (now > lead) {
        if (b && firstBusyAfterStart < 0) firstBusyAfterStart = (now - lead) / sr;
        if (!b && firstBusyAfterStart >= 0 && now < lead + frame.length && got.length === 0) droppedWhileFrame = true;
      }
      const endAt = lead + frame.length;
      if (now >= endAt + 0.4 * sr && now < endAt + 0.45 * sr) busyAt400 = b;
    }
    expect(busyBefore).toBe(false);
    expect(firstBusyAfterStart).toBeGreaterThan(0);
    expect(firstBusyAfterStart).toBeLessThanOrEqual(0.15);
    expect(droppedWhileFrame).toBe(false);
    expect(got.length).toBe(1);
    expect(Array.from(got[0]!.air)).toEqual(Array.from(air));
    expect(busyAt400).toBe(false);
  });

  it('emits two frames back to back in order', () => {
    const sr = 48_000;
    const rng = mulberry32(5000);
    const a = randomBytes(rng);
    const b = randomBytes(rng);
    const m = createModem({ sampleRate: sr, env: 'jungle', profile: 'fast' });
    const got = listen(m);
    const fa = m.encode(a, 0);
    const fb = m.encode(b, 3);
    const gap = Math.round(0.3 * sr);
    const x = new Float32Array(sr + fa.length + gap + fb.length + sr);
    x.set(fa, sr);
    x.set(fb, sr + fa.length + gap);
    m.push(x);
    expect(got.length).toBe(2);
    expect(Array.from(got[0]!.air)).toEqual(Array.from(a));
    expect(Array.from(got[1]!.air)).toEqual(Array.from(b));
  });

  it('reset() in the middle of a frame drops it, and a later frame is received', () => {
    const sr = 48_000;
    const rng = mulberry32(6000);
    const a = randomBytes(rng);
    const b = randomBytes(rng);
    const m = createModem({ sampleRate: sr, env: 'quiet', profile: 'fast' });
    const got = listen(m);
    const fa = withSilence(m.encode(a, 1), sr / 2, sr);
    const cut = Math.round(sr / 2 + 1.5 * sr);
    m.push(fa.subarray(0, cut));
    expect(m.busy()).toBe(true);
    m.reset();
    expect(m.busy()).toBe(false);
    m.push(fa.subarray(cut));
    expect(got.length).toBe(0);
    m.push(withSilence(m.encode(b, 1), sr / 2, sr));
    expect(got.length).toBe(1);
    expect(Array.from(got[0]!.air)).toEqual(Array.from(b));
  });
});
