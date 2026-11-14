export interface Position { x: number; y: number }

/** Linear gain from a speaker at `a` to a microphone at `b`. */
export function gainBetween(a: Position, b: Position, range: number): number {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (d > range) return 0;
  if (d === 0) return 1;
  return Math.min(1, 1 / d);
}

/**
 * tx[j] is what speaker j plays during this block (same length for all; a
 * dead or silent speaker passes zeros). Returns rx[i] for every microphone i:
 * the gain-weighted sum of every OTHER speaker, plus noise.
 * A node never hears itself here.
 */
export function mixBlock(
  tx: readonly Float32Array[], gains: readonly (readonly number[])[], // gains[j][i]: speaker j -> mic i
  noiseRms: number, rng: () => number,
): Float32Array[] {
  const n = tx.length;
  const len = n > 0 ? tx[0]!.length : 0;
  const rx: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const out = new Float32Array(len);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const g = gains[j]![i]!;
      if (g === 0) continue;
      const src = tx[j]!;
      for (let k = 0; k < len; k++) out[k]! += g * src[k]!;
    }
    if (noiseRms !== 0) {
      for (let k = 0; k < len; k++) {
        // Box-Muller
        const u1 = Math.max(rng(), 1e-12);
        const u2 = rng();
        out[k]! += noiseRms * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      }
    }
    rx.push(out);
  }
  return rx;
}
