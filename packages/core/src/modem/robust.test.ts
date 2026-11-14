import { describe, expect, it } from 'vitest';
import { FRAME_AIR_LEN } from '../constants.ts';
import { ENV_NAMES, envBand, PROFILE_NAMES, PROFILES } from '../envs.ts';
import type { EnvName, ProfileName } from '../envs.ts';
import { bytesToSymbols } from '../symbols.ts';
import { gaussian, mulberry32 } from '../util/prng.ts';
import { addNoise, convolve, makeBirdNoise, makeReverbIr, mixAt } from './channelSim.ts';
import { demodulateFrame } from './demod.ts';
import { createModem } from './index.ts';
import { renderFrame } from './synth.ts';
import { buildSymbolTemplates } from './templates.ts';

const SR = 48_000;
const FRAMES = 20;
const LONG = 20 * 60_000;

type Channel = (padded: Float32Array, env: EnvName, rng: () => number) => Float32Array;

function randomBytes(rng: () => number): Uint8Array {
  const b = new Uint8Array(FRAME_AIR_LEN);
  for (let i = 0; i < b.length; i++) b[i] = Math.floor(rng() * 256);
  return b;
}

function diffBytes(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

interface Counts {
  exact: number;
  fixable: number;
  missed: number;
  extra: number;
}

function runCase(label: string, env: EnvName, profile: ProfileName, channel: Channel, seed: number): Counts {
  const rng = mulberry32(seed);
  const counts: Counts = { exact: 0, fixable: 0, missed: 0, extra: 0 };
  for (let f = 0; f < FRAMES; f++) {
    const air = randomBytes(rng);
    const modem = createModem({ sampleRate: SR, env, profile });
    const got: Uint8Array[] = [];
    modem.onFrame((a) => got.push(a.slice()));
    const frame = modem.encode(air, f % 4);
    const padded = new Float32Array(SR + frame.length + SR);
    padded.set(frame, SR);
    const x = channel(padded, env, rng);
    for (let at = 0; at < x.length; at += 4096) modem.push(x.subarray(at, Math.min(x.length, at + 4096)));
    let best = FRAME_AIR_LEN + 1;
    for (const g of got) best = Math.min(best, diffBytes(g, air));
    if (got.length === 0) counts.missed++;
    if (best === 0) counts.exact++;
    if (best <= 4) counts.fixable++;
    counts.extra += Math.max(0, got.length - 1);
  }
  console.log(
    `[robust] ${label} ${env}/${profile}: exact ${counts.exact}/${FRAMES}, fixable ${counts.fixable}/${FRAMES}, no output ${counts.missed}, extra frames ${counts.extra}`,
  );
  return counts;
}

const noiseOnly = (snr: number): Channel => (x, _env, rng) => addNoise(x, snr, rng);
const reverbPlusNoise: Channel = (x, _env, rng) => {
  const ir = makeReverbIr(300, 6, SR, rng);
  return addNoise(convolve(x, ir), 10, rng);
};
const birdsPlusNoise: Channel = (x, env, rng) => {
  const { lowHz, highHz } = envBand(env);
  const birds = makeBirdNoise(x.length / SR, lowHz, highHz, SR, rng);
  return addNoise(mixAt(x, birds, -3), 10, rng);
};
const quiet: Channel = (x, _env, rng) => {
  const y = new Float32Array(x.length);
  for (let i = 0; i < y.length; i++) y[i] = x[i]! * 0.01;
  return addNoise(y, 10, rng);
};

const results: Record<string, number> = {};
let seed = 90_000;

describe('robustness (simulated channel)', () => {
  describe('A: noise at 0 dB SNR', () => {
    for (const env of ENV_NAMES) {
      for (const profile of PROFILE_NAMES) {
        it(`${env}/${profile}`, { timeout: LONG }, () => {
          const c = runCase('A', env, profile, noiseOnly(0), seed++);
          expect(c.fixable).toBeGreaterThanOrEqual(19);
        });
      }
    }
  });

  describe('B: reverb RT60 300 ms (+6 dB direct) and noise 10 dB, stealth', () => {
    for (const env of ENV_NAMES) {
      it(env, { timeout: LONG }, () => {
        const c = runCase('B', env, 'stealth', reverbPlusNoise, seed++);
        results[`B ${env}`] = c.fixable;
        expect(c.fixable).toBeGreaterThanOrEqual(19);
      });
    }
  });

  describe('C: reverb RT60 300 ms (+6 dB direct) and noise 10 dB, fast', () => {
    for (const env of ENV_NAMES) {
      it(env, { timeout: LONG }, () => {
        const c = runCase('C', env, 'fast', reverbPlusNoise, seed++);
        results[`C ${env}`] = c.fixable;
        expect(c.fixable).toBeGreaterThanOrEqual(17);
      });
    }
  });

  describe('D: bird noise at -3 dB plus noise 10 dB', () => {
    for (const env of ENV_NAMES) {
      for (const profile of PROFILE_NAMES) {
        it(`${env}/${profile}`, { timeout: LONG }, () => {
          const c = runCase('D', env, profile, birdsPlusNoise, seed++);
          results[`D ${env}/${profile}`] = c.fixable;
          expect(c.fixable).toBeGreaterThanOrEqual(18);
        });
      }
    }
  });

  describe('E: 60 s of loud bird noise and no frame', () => {
    for (const env of ENV_NAMES) {
      it(env, { timeout: LONG }, () => {
        const rng = mulberry32(seed++);
        const { lowHz, highHz } = envBand(env);
        const birds = makeBirdNoise(60, lowHz, highHz, SR, rng);
        let s = 0;
        for (const v of birds) s += v * v;
        const k = 0.2 / Math.sqrt(s / birds.length);
        const x = new Float32Array(birds.length);
        for (let i = 0; i < x.length; i++) x[i] = k * birds[i]! + 0.05 * gaussian(rng);
        const modem = createModem({ sampleRate: SR, env, profile: 'fast' });
        let calls = 0;
        modem.onFrame(() => calls++);
        for (let at = 0; at < x.length; at += 4096) modem.push(x.subarray(at, Math.min(x.length, at + 4096)));
        console.log(`[robust] E ${env}/fast: onFrame calls ${calls}`);
        expect(calls).toBeLessThanOrEqual(2);
      });
    }
  });

  describe('F: quiet signal (x0.01) with noise at 10 dB', () => {
    for (const profile of PROFILE_NAMES) {
      it(`quiet/${profile}`, { timeout: LONG }, () => {
        const c = runCase('F', 'quiet', profile, quiet, seed++);
        expect(c.fixable).toBeGreaterThanOrEqual(19);
      });
    }
  });

  it('summary of worst-case fixable counts (rows B, C, D)', () => {
    const worst = (prefix: string): number => {
      const v = Object.entries(results).filter(([k]) => k.startsWith(prefix)).map(([, n]) => n);
      return v.length ? Math.min(...v) : -1;
    };
    console.log(`[robust] worst fixable: B ${worst('B')}/20, C ${worst('C')}/20, D ${worst('D')}/20`);
  });

  describe('performance', () => {
    it('10 s of noise through a fast modem takes under 3 s', () => {
      const rng = mulberry32(777);
      const x = new Float32Array(10 * SR);
      for (let i = 0; i < x.length; i++) x[i] = 0.1 * gaussian(rng);
      const modem = createModem({ sampleRate: SR, env: 'city', profile: 'fast' });
      const t0 = performance.now();
      for (let at = 0; at < x.length; at += 4096) modem.push(x.subarray(at, Math.min(x.length, at + 4096)));
      const ms = performance.now() - t0;
      console.log(`[robust] 10 s noise: ${ms.toFixed(0)} ms`);
      expect(ms).toBeLessThan(3000);
    });

    it('demodulating one stealth frame takes under 2 s', () => {
      const rng = mulberry32(778);
      const air = randomBytes(rng);
      const frame = renderFrame(air, 0, 'jungle', 'stealth', SR);
      const tpl = buildSymbolTemplates('jungle', 'stealth', SR);
      const sync = Math.round((220 * SR) / 1000);
      const t0 = performance.now();
      const r = demodulateFrame(frame, sync, tpl, PROFILES.stealth, SR);
      const ms = performance.now() - t0;
      console.log(`[robust] stealth demod: ${ms.toFixed(0)} ms`);
      expect(ms).toBeLessThan(2000);
      expect(r.symbols).toEqual(bytesToSymbols(air, 4));
    });
  });
});
