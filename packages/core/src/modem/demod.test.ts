import { describe, expect, it } from 'vitest';
import { FRAME_AIR_LEN } from '../constants.ts';
import { ENV_NAMES, PROFILE_NAMES, PROFILES } from '../envs.ts';
import { bytesToSymbols } from '../symbols.ts';
import { mulberry32 } from '../util/prng.ts';
import { demodulateFrame } from './demod.ts';
import { renderFrame } from './synth.ts';
import { buildSymbolTemplates } from './templates.ts';

const SR = 48_000;

describe('demodulateFrame', () => {
  for (const env of ENV_NAMES) {
    for (const pn of PROFILE_NAMES) {
      it(`${env}/${pn}: clean frame decodes exactly, also with a sync error of +-20 samples`, () => {
        const rng = mulberry32(100 + env.length * 7 + pn.length);
        const air = new Uint8Array(FRAME_AIR_LEN);
        for (let i = 0; i < air.length; i++) air[i] = Math.floor(rng() * 256);
        const p = PROFILES[pn];
        const pad = 2000;
        const frame = renderFrame(air, 3, env, pn, SR);
        const x = new Float32Array(frame.length + 2 * pad);
        x.set(frame, pad);
        const truth = bytesToSymbols(air, p.bitsPerSymbol);
        const tpl = buildSymbolTemplates(env, pn, SR);
        const sync = pad + Math.round((220 * SR) / 1000);
        for (const err of [0, 20, -20]) {
          const r = demodulateFrame(x, sync + err, tpl, p, SR);
          expect(r.symbols).toEqual(truth);
          expect(r.confidence).toBeGreaterThan(0.3);
        }
      });
    }
  }
});
