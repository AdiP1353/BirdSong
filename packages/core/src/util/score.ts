import { ENVS, PROFILES, envPitchesHz } from '../envs.ts';
import type { EnvName, ProfileName } from '../envs.ts';
import { bytesToSymbols, shapeFreqs, symbolPitchIndex, symbolShape } from '../symbols.ts';
import { symbolStartMs } from '../timing.ts';

export interface ScoreNote {
  startMs: number; durMs: number; pitchIndex: number; shape: number;
  midi: number; hzStart: number; hzMid: number; hzEnd: number;
}

export function frameNotes(air: Uint8Array, env: EnvName, profile: ProfileName): ScoreNote[] {
  const p = PROFILES[profile];
  const pitches = envPitchesHz(env);
  return bytesToSymbols(air, p.bitsPerSymbol).map((sym, i) => {
    const pitchIndex = symbolPitchIndex(sym);
    const shape = symbolShape(sym);
    const f = shapeFreqs(pitches[pitchIndex]!, shape);
    return {
      startMs: symbolStartMs(i, p),
      durMs: p.syllableMs,
      pitchIndex,
      shape,
      midi: ENVS[env].midi[pitchIndex]!,
      hzStart: f.start,
      hzMid: f.mid,
      hzEnd: f.end,
    };
  });
}
