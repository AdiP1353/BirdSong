/**
 * The eavesdropper's view: someone with a microphone but no passphrase. They can demodulate every frame (the
 * modulation is public), read the header, and even put the fountain droplets back together into the sealed
 * envelope. What they cannot do is open it.
 */
import {
  ENVELOPE_HEADER_LEN, GCM_TAG_LEN, createFountainDecoder, decodeAirFrame, deriveChannel, fromHex, openMessage,
} from '@birdsong/core';
import type { TelemetryEvent } from '@birdsong/core';

export interface SpyCapture {
  /** Distinct frames of this message heard on the air. */
  frames: number;
  /** Blocks the message was cut into. */
  k: number;
  /** Who sang it, read from the clear header. */
  senders: number[];
  /** The sealed envelope once enough frames were caught, else null. */
  envelope: Uint8Array | null;
  /** The encrypted part of the envelope (or, before that, the raw payloads caught so far). */
  ciphertext: Uint8Array;
}

/** What a listener without the key gets from the frames sung for `msgId`. */
export function spyCapture(events: TelemetryEvent[], msgId: number | null): SpyCapture | null {
  if (msgId === null) return null;
  const seen = new Set<string>();
  const senders = new Set<number>();
  const payloads: Uint8Array[] = [];
  let decoder: ReturnType<typeof createFountainDecoder> | null = null;
  let k = 0;
  for (const e of events) {
    if (e.type !== 'sang' || e.msgId !== msgId || seen.has(e.airHex)) continue;
    seen.add(e.airHex);
    const r = decodeAirFrame(fromHex(e.airHex));
    if (!r) continue;
    const f = r.frame;
    senders.add(f.sender);
    if (!decoder || k !== f.k) {
      k = f.k;
      decoder = createFountainDecoder(k);
      payloads.length = 0;
    }
    payloads.push(f.payload);
    decoder.add(f.seed, f.payload);
  }
  if (!decoder) return null;
  const envelope = decoder.done ? decoder.envelope() : null;
  let ciphertext: Uint8Array;
  if (envelope) {
    ciphertext = envelope.subarray(ENVELOPE_HEADER_LEN, Math.max(ENVELOPE_HEADER_LEN, envelope.length - GCM_TAG_LEN));
  } else {
    ciphertext = new Uint8Array(payloads.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of payloads) { ciphertext.set(p, at); at += p.length; }
  }
  return { frames: seen.size, k, senders: [...senders].sort((a, b) => a - b), envelope, ciphertext };
}

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&$@?!+=*<>~^';

/** Bytes shown as the text an eavesdropper would read: one stable, printable character per byte. */
export function scramble(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += GLYPHS[b % GLYPHS.length];
  return s;
}

/** Try to open the envelope with a passphrase. null = wrong key (the message does not authenticate). */
export async function tryPassphrase(envelope: Uint8Array, passphrase: string): Promise<{ text: string; alias: string } | null> {
  const ch = await deriveChannel(passphrase);
  const opened = await openMessage(ch, envelope);
  return opened ? { text: opened.text, alias: opened.alias } : null;
}
