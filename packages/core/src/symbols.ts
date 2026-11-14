import { SWEEP_RATIO } from './envs.ts';

export const SHAPE_UP = 0;
export const SHAPE_DOWN = 1;
export const SHAPE_HOOK = 2; // up then down
export const SHAPE_DIP = 3; // down then up

/** A symbol is an integer: low 3 bits = pitch index (0..7), upper bits = shape. */
export function symbolPitchIndex(sym: number): number {
  return sym & 7;
}
export function symbolShape(sym: number): number {
  return sym >> 3;
}
export function makeSymbol(pitchIndex: number, shape: number): number {
  return (shape << 3) | (pitchIndex & 7);
}

/**
 * Frequency of a chirp at its start, its midpoint and its end. The frequency
 * moves linearly start -> mid over the first half and mid -> end over the
 * second half. Synth and receiver templates must both use this function.
 */
export function shapeFreqs(pitchHz: number, shape: number): { start: number; mid: number; end: number } {
  const lo = pitchHz;
  const hi = pitchHz * SWEEP_RATIO;
  const half = (lo + hi) / 2;
  switch (shape) {
    case SHAPE_UP: return { start: lo, mid: half, end: hi };
    case SHAPE_DOWN: return { start: hi, mid: half, end: lo };
    case SHAPE_HOOK: return { start: lo, mid: hi, end: lo };
    case SHAPE_DIP: return { start: hi, mid: lo, end: hi };
    default: throw new Error(`unknown shape ${shape}`);
  }
}

/** Pack bytes into symbols, most significant bit first, zero-padded at the end. */
export function bytesToSymbols(bytes: Uint8Array, bitsPerSymbol: number): number[] {
  const out: number[] = [];
  const totalBits = bytes.length * 8;
  for (let bit = 0; bit < totalBits; bit += bitsPerSymbol) {
    let sym = 0;
    for (let j = 0; j < bitsPerSymbol; j++) {
      const idx = bit + j;
      const b = idx < totalBits ? (bytes[idx >> 3]! >> (7 - (idx & 7))) & 1 : 0;
      sym = (sym << 1) | b;
    }
    out.push(sym);
  }
  return out;
}

/** Inverse of bytesToSymbols. Extra padding bits are discarded. */
export function symbolsToBytes(symbols: readonly number[], bitsPerSymbol: number, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  const totalBits = byteLen * 8;
  for (let i = 0; i < symbols.length; i++) {
    for (let j = 0; j < bitsPerSymbol; j++) {
      const idx = i * bitsPerSymbol + j;
      if (idx >= totalBits) return out;
      const b = (symbols[i]! >> (bitsPerSymbol - 1 - j)) & 1;
      if (b) out[idx >> 3] |= 1 << (7 - (idx & 7));
    }
  }
  return out;
}
