import { describe, expect, it } from 'vitest';
import { FRAME_AIR_LEN } from '../constants.ts';
import { ENV_NAMES, PROFILE_NAMES, PROFILES } from '../envs.ts';
import { frameAirtimeMs } from '../timing.ts';
import { mulberry32 } from '../util/prng.ts';
import { msToSamples, renderChirp, renderFrame, renderFrameUnscaled } from './synth.ts';

function randomBytes(rng: () => number): Uint8Array {
  const b = new Uint8Array(FRAME_AIR_LEN);
  for (let i = 0; i < b.length; i++) b[i] = Math.floor(rng() * 256);
  return b;
}

describe('synth', () => {
  it('frame length and peak for both profiles at 48000 and 44100', () => {
    const rng = mulberry32(1);
    for (const sr of [48_000, 44_100]) {
      for (const pn of PROFILE_NAMES) {
        const out = renderFrame(randomBytes(rng), 0, 'quiet', pn, sr);
        expect(out.length).toBe(Math.round((frameAirtimeMs(PROFILES[pn]) * sr) / 1000));
        let peak = 0;
        for (const v of out) peak = Math.max(peak, Math.abs(v));
        expect(Math.abs(peak - 0.8)).toBeLessThan(0.001);
      }
    }
  });

  it('is silent in the gaps before and after the sync', () => {
    const sr = 48_000;
    for (const env of ENV_NAMES) {
      const out = renderFrame(randomBytes(mulberry32(2)), 1, env, 'fast', sr);
      for (const [a, b] of [[160, 220], [360, 400]] as const) {
        for (let n = msToSamples(a, sr); n < msToSamples(b, sr); n++) expect(out[n]).toBe(0);
      }
    }
  });

  it('species differ in audio but share an identical sync', () => {
    const sr = 48_000;
    const air = randomBytes(mulberry32(3));
    const a = renderFrameUnscaled(air, 0, 'jungle', 'stealth', sr);
    const b = renderFrameUnscaled(air, 2, 'jungle', 'stealth', sr);
    const pa = renderFrame(air, 0, 'jungle', 'stealth', sr);
    const pb = renderFrame(air, 2, 'jungle', 'stealth', sr);
    const from = msToSamples(220, sr);
    const to = msToSamples(360, sr);
    let maxDiffSync = 0;
    for (let n = from; n < to; n++) maxDiffSync = Math.max(maxDiffSync, Math.abs(pa[n]! / a.scale - pb[n]! / b.scale));
    expect(maxDiffSync).toBeLessThan(1e-6);
    let diffAll = 0;
    for (let n = 0; n < pa.length; n++) diffAll += Math.abs(pa[n]! - pb[n]!);
    expect(diffAll).toBeGreaterThan(1);
  });

  it('species index wraps modulo 4', () => {
    const air = randomBytes(mulberry32(4));
    expect(renderFrame(air, 5, 'quiet', 'fast', 8000 * 6)).toEqual(renderFrame(air, 1, 'quiet', 'fast', 8000 * 6));
  });

  it('rejects wrong air length', () => {
    expect(() => renderFrame(new Uint8Array(31), 0, 'quiet', 'fast', 48_000)).toThrow(RangeError);
  });

  it('drops the third harmonic when it would alias', () => {
    const plain = renderChirp({ start: 5000, mid: 5000, end: 5000 }, 20, 20_000, { harmonic3: 0.5 });
    const none = renderChirp({ start: 5000, mid: 5000, end: 5000 }, 20, 20_000, { harmonic3: 0 });
    expect(plain).toEqual(none);
  });
});
