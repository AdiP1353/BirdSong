/**
 * The modem against microphone-like room noise (see sim/roomNoise.ts): what the dashboard's "Add noise" panel
 * puts into the ether, and what a real phone hears in a busy room.
 *
 * Levels are the RMS of the room noise relative to the RMS of the frame (the frame's non-zero span), over the
 * whole 0-24 kHz band. Most room noise is below the birds' band, so the in-band SNR is about 9-11 dB better.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_AIR_LEN } from '../constants.ts';
import { ENV_NAMES, PROFILE_NAMES } from '../envs.ts';
import type { EnvName, ProfileName } from '../envs.ts';
import { makeRoomNoise } from '../sim/roomNoise.ts';
import { gaussian, mulberry32 } from '../util/prng.ts';
import { createModem } from './index.ts';

const SR = 48_000;
const LONG = 10 * 60_000;
/** Push size: one ether block (20 ms), as the containers receive it. */
const CHUNK = 960;

function randomBytes(rng: () => number): Uint8Array {
  const b = new Uint8Array(FRAME_AIR_LEN);
  for (let i = 0; i < b.length; i++) b[i] = Math.floor(rng() * 256);
  return b;
}

function spanRms(x: Float32Array): number {
  let s = 0;
  let n = 0;
  for (const v of x) if (v !== 0) { s += v * v; n++; }
  return Math.sqrt(s / Math.max(1, n));
}

function diffBytes(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** One frame `lead` seconds into room noise at `db`. Returns the samples and where the frame is. */
function frameInNoise(env: EnvName, profile: ProfileName, db: number, rng: () => number, lead = 3) {
  const air = randomBytes(rng);
  const frame = createModem({ sampleRate: SR, env, profile }).encode(air, Math.floor(rng() * 4));
  const start = lead * SR;
  const x = new Float32Array(start + frame.length + SR);
  const noise = makeRoomNoise(x.length / SR, SR, rng);
  const g = spanRms(frame) * 10 ** (db / 20);
  for (let i = 0; i < x.length; i++) x[i] = g * noise[i]!;
  for (let i = 0; i < frame.length; i++) x[start + i]! += frame[i]!;
  return { air, x, start, end: start + frame.length };
}

describe('room noise generator', () => {
  it('is deterministic and has about unit background RMS', () => {
    const a = makeRoomNoise(2, SR, mulberry32(1), { clicksPerSecond: 0 });
    const b = makeRoomNoise(2, SR, mulberry32(1), { clicksPerSecond: 0 });
    expect(Array.from(a.subarray(0, 1000))).toEqual(Array.from(b.subarray(0, 1000)));
    let s = 0;
    for (const v of a) s += v * v;
    expect(Math.sqrt(s / a.length)).toBeGreaterThan(0.8);
    expect(Math.sqrt(s / a.length)).toBeLessThan(1.25);
  });

  it('works at 8 kHz (the simulated mesh rate)', () => {
    const x = makeRoomNoise(1, 8000, mulberry32(2));
    expect(x.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('carrier sense in room noise', () => {
  // A bird that thinks the air is always busy backs off up to 20 times (about 35 s) before every frame,
  // so a message barely moves. Room noise alone must not look like another bird singing.
  for (const env of ['quiet', 'coast'] as const) {
    for (const level of [0.01, 0.2]) {
      it(`${env}: 30 s of room noise at RMS ${level} is busy at most 5% of the time`, { timeout: LONG }, () => {
        const rng = mulberry32(env === 'quiet' ? 11 : 12);
        const x = makeRoomNoise(32, SR, rng);
        for (let i = 0; i < x.length; i++) x[i] = x[i]! * level;
        const m = createModem({ sampleRate: SR, env, profile: 'fast' });
        let busy = 0;
        let blocks = 0;
        for (let at = 0; at + CHUNK <= x.length; at += CHUNK) {
          m.push(x.subarray(at, at + CHUNK));
          if (at >= 2 * SR) { blocks++; if (m.busy()) busy++; }
        }
        console.log(`[room] ${env} noise RMS ${level}: busy ${(100 * busy / blocks).toFixed(1)}%`);
        expect(busy / blocks).toBeLessThanOrEqual(0.05);
      });
    }
  }

  it('a weak phantom sync inside a frame does not hold the air after the frame ends', () => {
    // coast/fast data chirps sometimes look like a sync (score just over the 0.25 threshold). Such a candidate
    // waits a whole frame (about 2.8 s) to be demodulated; it must not keep the channel busy all that time,
    // or the bird that just decoded the message backs off and the next hop is suppressed.
    const rng = mulberry32(9);
    let late = 0;
    let phantoms = 0;
    for (let f = 0; f < 15; f++) {
      const m = createModem({ sampleRate: SR, env: 'coast', profile: 'fast' });
      const air = randomBytes(rng);
      const frame = m.encode(air, f % 4);
      const lead = SR;
      const end = lead + frame.length;
      const x = new Float32Array(end + 3 * SR);
      for (let i = 0; i < x.length; i++) x[i] = (i >= lead && i < end ? 0.8 * frame[i - lead]! : 0) + 0.003 * gaussian(rng);
      m.onFrame((a) => { if (diffBytes(a, air) > 4) phantoms++; });
      for (let at = 0; at + CHUNK <= x.length; at += CHUNK) {
        m.push(x.subarray(at, at + CHUNK));
        if (at + CHUNK >= end + 0.6 * SR && m.busy()) late++;
      }
    }
    console.log(`[room] phantom candidates: ${phantoms}, busy blocks later than 0.6 s after a frame: ${late}`);
    expect(phantoms).toBeGreaterThan(0); // the case this test is about happens
    expect(late).toBe(0);
  });

  it('a steady whistle in the band stops counting as song once it is the floor (within 5 s)', () => {
    const x = new Float32Array(10 * SR);
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 3000 * i) / SR);
    const m = createModem({ sampleRate: SR, env: 'quiet', profile: 'fast' });
    let busyLate = 0;
    for (let at = 0; at + CHUNK <= x.length; at += CHUNK) {
      m.push(x.subarray(at, at + CHUNK));
      if (at >= 6 * SR && m.busy()) busyLate++;
    }
    expect(busyLate).toBe(0);
  });

  for (const profile of PROFILE_NAMES) {
    it(`still hears a ${profile} frame through room noise at 0 dB: busy early and through the frame`, { timeout: LONG }, () => {
      const rng = mulberry32(profile === 'fast' ? 21 : 22);
      const { air, x, start, end } = frameInNoise('quiet', profile, 0, rng);
      const m = createModem({ sampleRate: SR, env: 'quiet', profile });
      const got: Uint8Array[] = [];
      m.onFrame((a) => got.push(a.slice()));
      let firstBusy = -1;
      let busyIn = 0;
      let blocksIn = 0;
      for (let at = 0; at + CHUNK <= x.length; at += CHUNK) {
        m.push(x.subarray(at, at + CHUNK));
        const now = at + CHUNK;
        if (now > start && now <= end && got.length === 0) {
          blocksIn++;
          if (m.busy()) {
            busyIn++;
            if (firstBusy < 0) firstBusy = (now - start) / SR;
          }
        }
      }
      console.log(`[room] ${profile} frame at 0 dB: first busy after ${firstBusy.toFixed(2)} s, busy ${(100 * busyIn / blocksIn).toFixed(0)}% of the frame`);
      expect(firstBusy).toBeGreaterThan(0);
      expect(firstBusy).toBeLessThanOrEqual(0.2);
      expect(busyIn / blocksIn).toBeGreaterThanOrEqual(0.9);
      expect(got.some((g) => diffBytes(g, air) === 0)).toBe(true);
    });
  }
});

describe('decoding through room noise', () => {
  // +10 dB: the noise is about three times louder than the bird over the whole band.
  for (const env of ENV_NAMES) {
    for (const profile of PROFILE_NAMES) {
      const frames = profile === 'fast' ? 10 : 5;
      it(`${env}/${profile}: ${frames} frames in room noise at +10 dB, all fixable by Reed-Solomon`, { timeout: LONG }, () => {
        const rng = mulberry32(3000 + ENV_NAMES.indexOf(env) * 10 + PROFILE_NAMES.indexOf(profile));
        let fixable = 0;
        let exact = 0;
        for (let f = 0; f < frames; f++) {
          const { air, x } = frameInNoise(env, profile, 10, rng, 2);
          const m = createModem({ sampleRate: SR, env, profile });
          const got: Uint8Array[] = [];
          m.onFrame((a) => got.push(a.slice()));
          for (let at = 0; at < x.length; at += CHUNK) m.push(x.subarray(at, Math.min(x.length, at + CHUNK)));
          const best = Math.min(FRAME_AIR_LEN, ...got.map((g) => diffBytes(g, air)));
          if (best <= 4) fixable++;
          if (best === 0) exact++;
        }
        console.log(`[room] ${env}/${profile} +10 dB: fixable ${fixable}/${frames}, exact ${exact}`);
        expect(fixable).toBe(frames);
      });
    }
  }

  it('60 s of loud room noise alone produces at most one phantom frame', { timeout: LONG }, () => {
    const rng = mulberry32(44);
    const x = makeRoomNoise(60, SR, rng);
    for (let i = 0; i < x.length; i++) x[i] = x[i]! * 0.3;
    const m = createModem({ sampleRate: SR, env: 'quiet', profile: 'fast' });
    let calls = 0;
    m.onFrame(() => calls++);
    for (let at = 0; at < x.length; at += CHUNK) m.push(x.subarray(at, Math.min(x.length, at + CHUNK)));
    expect(calls).toBeLessThanOrEqual(1);
  });
});
