import type { Frame } from '../types.ts';

function todo(): never {
  throw new Error('not implemented: plan 002');
}

export interface Channel {
  key: CryptoKey;
  netTag: number;
}
export interface FountainDecoder {
  readonly k: number;
  readonly rank: number;
  readonly done: boolean;
  /** Returns true if the droplet increased the rank. */
  add(seed: number, payload: Uint8Array): boolean;
  /** The reassembled envelope with padding removed, or null if not done or malformed. */
  envelope(): Uint8Array | null;
}

export function deriveChannel(_passphrase: string): Promise<Channel> { return todo(); }
export function sealMessage(_ch: Channel, _text: string, _alias: string, _nonce4?: Uint8Array): Promise<Uint8Array> { return todo(); }
export function openMessage(_ch: Channel, _envelope: Uint8Array): Promise<{ text: string; alias: string } | null> { return todo(); }
export function msgIdOf(_envelope: Uint8Array): Promise<number> { return todo(); }
export function splitBlocks(_envelope: Uint8Array): Uint8Array[] { return todo(); }
export function makeDroplet(_blocks: readonly Uint8Array[], _seed: number): Uint8Array { return todo(); }
export function createFountainDecoder(_k: number): FountainDecoder { return todo(); }
export function encodeAirFrame(_frame: Frame): Uint8Array { return todo(); }
export function decodeAirFrame(_air: Uint8Array): { frame: Frame; corrected: number } | null { return todo(); }
