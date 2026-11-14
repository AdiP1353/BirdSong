import { FRAME_AIR_LEN } from './constants.ts';
import type { Profile } from './envs.ts';

/**
 * Layout of one frame on air, in milliseconds from the start of the frame:
 *
 *   [intro: 3 notes of 40 ms, 20 ms apart]   0 .. 160   (decoration, never decoded)
 *   [gap 60]
 *   [sync: up-sweep 60, gap 20, down-sweep 60]  220 .. 360   (what the receiver detects)
 *   [gap 40]
 *   [data symbols]  400 ..
 *   [tail 20]
 */
export const INTRO_NOTES = 3;
export const INTRO_NOTE_MS = 40;
export const INTRO_GAP_MS = 20;
export const INTRO_MS = INTRO_NOTES * INTRO_NOTE_MS + (INTRO_NOTES - 1) * INTRO_GAP_MS; // 160
export const PRE_SYNC_GAP_MS = 60;
export const SYNC_START_MS = INTRO_MS + PRE_SYNC_GAP_MS; // 220
export const SYNC_SWEEP_MS = 60;
export const SYNC_GAP_MS = 20;
export const SYNC_MS = 2 * SYNC_SWEEP_MS + SYNC_GAP_MS; // 140
export const POST_SYNC_GAP_MS = 40;
export const DATA_START_MS = SYNC_START_MS + SYNC_MS + POST_SYNC_GAP_MS; // 400
export const TAIL_MS = 20;

export function symbolsPerFrame(p: Profile): number {
  return Math.ceil((FRAME_AIR_LEN * 8) / p.bitsPerSymbol);
}

/** Start time of data symbol `i` (0-based) from the start of the frame. */
export function symbolStartMs(i: number, p: Profile): number {
  const pauses = p.phraseLen > 0 ? Math.floor(i / p.phraseLen) : 0;
  return DATA_START_MS + i * (p.syllableMs + p.gapMs) + pauses * p.phrasePauseMs;
}

/** Total duration of one frame on air. stealth = 8910 ms, fast = 3010 ms. */
export function frameAirtimeMs(p: Profile): number {
  return symbolStartMs(symbolsPerFrame(p) - 1, p) + p.syllableMs + TAIL_MS;
}
