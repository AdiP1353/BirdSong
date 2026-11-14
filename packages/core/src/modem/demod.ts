import type { Profile } from '../envs.ts';
import { SYNC_START_MS, symbolStartMs, symbolsPerFrame } from '../timing.ts';
import type { SymbolTemplates } from './templates.ts';

/** Half-width of the per-symbol timing search, in milliseconds. */
export const TIMING_SEARCH_MS = 1;

/**
 * Decide every data symbol of one frame.
 * `x` is the band-passed input containing the whole frame; `syncStart` is the index in `x` where the sync starts.
 */
export function demodulateFrame(
  x: Float32Array,
  syncStart: number,
  templates: SymbolTemplates,
  profile: Profile,
  sampleRate: number,
  searchMs: number = TIMING_SEARCH_MS,
): { symbols: number[]; confidence: number } {
  const count = symbolsPerFrame(profile);
  const tpls = templates.templates;
  const D = Math.round((searchMs / 1000) * sampleRate);
  const step = Math.max(1, Math.round(D / 4));
  const offsets: number[] = [];
  for (let d = -D; d <= D; d += step) offsets.push(d);

  const symbols: number[] = [];
  let marginSum = 0;
  const xl = x.length;

  for (let i = 0; i < count; i++) {
    const nominal = syncStart + Math.round(((symbolStartMs(i, profile) - SYNC_START_MS) * sampleRate) / 1000);
    let best = -1;
    let bestScore = -1;
    let second = -1;
    for (let s = 0; s < tpls.length; s++) {
      const t = tpls[s]!;
      const tre = t.re;
      const tim = t.im;
      const tl = tre.length;
      let score = 0;
      for (let oi = 0; oi < offsets.length; oi++) {
        const start = nominal + offsets[oi]!;
        const lo = Math.max(0, -start);
        const hi = Math.min(tl, xl - start);
        let re = 0;
        let im = 0;
        for (let n = lo; n < hi; n++) {
          const v = x[start + n]!;
          re += v * tre[n]!;
          im -= v * tim[n]!;
        }
        const mag = re * re + im * im; // squared magnitude, monotone in magnitude
        if (mag > score) score = mag;
      }
      score = Math.sqrt(score);
      if (score > bestScore) {
        second = Math.max(second, bestScore);
        bestScore = score;
        best = s;
      } else if (score > second) {
        second = score;
      }
    }
    symbols.push(best);
    marginSum += bestScore > 0 ? (bestScore - Math.max(second, 0)) / bestScore : 0;
  }
  return { symbols, confidence: count > 0 ? marginSum / count : 0 };
}
