import {
  GCM_TAG_LEN,
  MAX_ALIAS_CHARS,
  MAX_ENVELOPE_LEN,
  MAX_TEXT_CHARS,
  NONCE_RANDOM_LEN,
  PBKDF2_ITERATIONS,
  PBKDF2_SALT,
  PROTOCOL_VERSION,
} from '../constants.ts';
import { compressText, decompressText } from './compress.ts';

export interface Channel {
  key: CryptoKey;
  netTag: number;
}

const subtle = globalThis.crypto.subtle;
const MIN_ENVELOPE = 6 + GCM_TAG_LEN;

export async function deriveChannel(passphrase: string): Promise<Channel> {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(PBKDF2_SALT), iterations: PBKDF2_ITERATIONS },
      base,
      264,
    ),
  );
  const key = await subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, netTag: bits[32]! };
}

function params(nonce4: Uint8Array, flags: number): AesGcmParams {
  const iv = new Uint8Array(12);
  iv.set(nonce4.subarray(0, NONCE_RANDOM_LEN));
  return { name: 'AES-GCM', iv, tagLength: GCM_TAG_LEN * 8, additionalData: Uint8Array.of(PROTOCOL_VERSION, flags) };
}

export async function sealMessage(ch: Channel, text: string, alias: string, nonce4?: Uint8Array): Promise<Uint8Array> {
  const textLen = [...text].length;
  if (textLen < 1 || textLen > MAX_TEXT_CHARS) throw new RangeError('text must be 1..MAX_TEXT_CHARS characters');
  if ([...alias].length > MAX_ALIAS_CHARS) throw new RangeError('alias too long');
  if (alias.includes('\n')) throw new RangeError('alias must not contain a newline');
  const plain = compressText(alias + '\n' + text);
  const flags = plain.compressed ? 1 : 0;
  const nonce = nonce4 ? nonce4.slice(0, NONCE_RANDOM_LEN) : globalThis.crypto.getRandomValues(new Uint8Array(NONCE_RANDOM_LEN));
  const ct = new Uint8Array(await subtle.encrypt(params(nonce, flags), ch.key, plain.bytes.slice()));
  const total = 2 + NONCE_RANDOM_LEN + ct.length;
  if (total > MAX_ENVELOPE_LEN) throw new RangeError('message too long');
  const env = new Uint8Array(total);
  env[0] = total;
  env[1] = flags;
  env.set(nonce, 2);
  env.set(ct, 2 + NONCE_RANDOM_LEN);
  return env;
}

export async function openMessage(ch: Channel, envelope: Uint8Array): Promise<{ text: string; alias: string } | null> {
  if (envelope.length < MIN_ENVELOPE || envelope[0] !== envelope.length) return null;
  try {
    const flags = envelope[1]!;
    const nonce = envelope.slice(2, 2 + NONCE_RANDOM_LEN);
    const ct = envelope.slice(2 + NONCE_RANDOM_LEN);
    const plain = new Uint8Array(await subtle.decrypt(params(nonce, flags), ch.key, ct));
    const s = decompressText(plain, (flags & 1) === 1);
    const nl = s.indexOf('\n');
    if (nl < 0) return null;
    return { alias: s.slice(0, nl), text: s.slice(nl + 1) };
  } catch {
    return null;
  }
}

export async function msgIdOf(envelope: Uint8Array): Promise<number> {
  const d = new Uint8Array(await subtle.digest('SHA-256', envelope.slice()));
  return (d[0]! << 8) | d[1]!;
}
