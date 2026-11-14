import { BLOCK_SIZE, ENVELOPE_HEADER_LEN, GCM_TAG_LEN, MAX_K, MAX_SEED } from '../constants.ts';
import { gfDiv, gfExp, gfMul } from './gf256.ts';

export interface FountainDecoder {
  readonly k: number;
  readonly rank: number;
  readonly done: boolean;
  /** Returns true if the droplet increased the rank. */
  add(seed: number, payload: Uint8Array): boolean;
  /** The reassembled envelope with padding removed, or null if not done or malformed. */
  envelope(): Uint8Array | null;
}

export function splitBlocks(envelope: Uint8Array): Uint8Array[] {
  const k = Math.ceil(envelope.length / BLOCK_SIZE);
  if (k < 1 || k > MAX_K) throw new RangeError('envelope needs 1..MAX_K blocks');
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < k; i++) {
    const block = new Uint8Array(BLOCK_SIZE);
    block.set(envelope.subarray(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE));
    blocks.push(block);
  }
  return blocks;
}

export function makeDroplet(blocks: readonly Uint8Array[], seed: number): Uint8Array {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new RangeError('seed out of range');
  const out = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < blocks.length; i++) {
    const c = gfExp(seed * i);
    const blk = blocks[i]!;
    for (let b = 0; b < BLOCK_SIZE; b++) out[b] = out[b]! ^ gfMul(c, blk[b]!);
  }
  return out;
}

export function createFountainDecoder(k: number): FountainDecoder {
  const width = k + BLOCK_SIZE;
  const rows: Uint8Array[] = [];
  const pivots: number[] = [];

  function addScaledRow(dst: Uint8Array, src: Uint8Array, factor: number): void {
    for (let i = 0; i < width; i++) dst[i] = dst[i]! ^ gfMul(factor, src[i]!);
  }

  return {
    k,
    get rank() {
      return rows.length;
    },
    get done() {
      return rows.length === k;
    },
    add(seed: number, payload: Uint8Array): boolean {
      if (rows.length === k) return false;
      if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) return false;
      if (payload.length !== BLOCK_SIZE) return false;
      const row = new Uint8Array(width);
      for (let i = 0; i < k; i++) row[i] = gfExp(seed * i);
      row.set(payload, k);
      for (let r = 0; r < rows.length; r++) {
        const f = row[pivots[r]!]!;
        if (f !== 0) addScaledRow(row, rows[r]!, f);
      }
      let pivot = -1;
      for (let i = 0; i < k; i++) {
        if (row[i] !== 0) {
          pivot = i;
          break;
        }
      }
      if (pivot < 0) return false;
      const inv = gfDiv(1, row[pivot]!);
      for (let i = 0; i < width; i++) row[i] = gfMul(row[i]!, inv);
      for (let r = 0; r < rows.length; r++) {
        const f = rows[r]![pivot]!;
        if (f !== 0) addScaledRow(rows[r]!, row, f);
      }
      rows.push(row);
      pivots.push(pivot);
      return true;
    },
    envelope(): Uint8Array | null {
      if (rows.length !== k) return null;
      const order = pivots.map((p, idx) => [p, idx] as const).sort((a, b) => a[0] - b[0]);
      const bytes = new Uint8Array(k * BLOCK_SIZE);
      order.forEach(([, idx], pos) => bytes.set(rows[idx]!.subarray(k, k + BLOCK_SIZE), pos * BLOCK_SIZE));
      const len = bytes[0]!;
      if (len < ENVELOPE_HEADER_LEN + GCM_TAG_LEN || len > k * BLOCK_SIZE || Math.ceil(len / BLOCK_SIZE) !== k) {
        return null;
      }
      return bytes.slice(0, len);
    },
  };
}
