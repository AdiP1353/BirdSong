import { BLOCK_SIZE, FRAME_AIR_LEN, FRAME_BODY_LEN, MAX_SEED, RS_PARITY_LEN } from '../constants.ts';
import type { Frame } from '../types.ts';
import { crc16 } from './crc16.ts';
import { rsDecode, rsEncode } from './rs.ts';

function inRange(v: number, lo: number, hi: number): boolean {
  return Number.isInteger(v) && v >= lo && v <= hi;
}

export function encodeAirFrame(frame: Frame): Uint8Array {
  if (!inRange(frame.netTag, 0, 255)) throw new RangeError('netTag out of range');
  if (!inRange(frame.msgId, 0, 65535)) throw new RangeError('msgId out of range');
  if (!inRange(frame.k, 1, 15)) throw new RangeError('k out of range');
  if (!inRange(frame.hop, 0, 15)) throw new RangeError('hop out of range');
  if (!inRange(frame.seed, 0, MAX_SEED)) throw new RangeError('seed out of range');
  if (!inRange(frame.sender, 0, 255)) throw new RangeError('sender out of range');
  if (frame.payload.length !== BLOCK_SIZE) throw new RangeError('payload must be BLOCK_SIZE bytes');
  const body = new Uint8Array(FRAME_BODY_LEN);
  body[0] = frame.netTag;
  body[1] = frame.msgId >> 8;
  body[2] = frame.msgId & 0xff;
  body[3] = (frame.k << 4) | frame.hop;
  body[4] = frame.seed;
  body[5] = frame.sender;
  body.set(frame.payload, 6);
  const crc = crc16(body.subarray(0, FRAME_BODY_LEN - 2));
  body[FRAME_BODY_LEN - 2] = crc >> 8;
  body[FRAME_BODY_LEN - 1] = crc & 0xff;
  return rsEncode(body, RS_PARITY_LEN);
}

export function decodeAirFrame(air: Uint8Array): { frame: Frame; corrected: number } | null {
  if (air.length !== FRAME_AIR_LEN) return null;
  const rs = rsDecode(air, RS_PARITY_LEN);
  if (!rs) return null;
  const b = rs.data;
  const crc = crc16(b.subarray(0, FRAME_BODY_LEN - 2));
  if (((b[FRAME_BODY_LEN - 2]! << 8) | b[FRAME_BODY_LEN - 1]!) !== crc) return null;
  const k = b[3]! >> 4;
  const seed = b[4]!;
  if (k === 0 || seed > MAX_SEED) return null;
  return {
    frame: {
      netTag: b[0]!,
      msgId: (b[1]! << 8) | b[2]!,
      k,
      hop: b[3]! & 0x0f,
      seed,
      sender: b[5]!,
      payload: b.slice(6, 6 + BLOCK_SIZE),
    },
    corrected: rs.corrected,
  };
}
