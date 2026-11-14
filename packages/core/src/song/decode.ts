import { createFountainDecoder, decodeAirFrame, deriveChannel, msgIdOf, openMessage } from '../codec/index.ts';
import type { FountainDecoder } from '../codec/index.ts';
import { createModem } from '../modem/index.ts';
import type { DecodedSongMessage, SongOptions } from './index.ts';

const CHUNK = 4096;
const TRAILING_SILENCE_S = 3;

export async function decodeSong(pcm: Float32Array, opts: SongOptions): Promise<DecodedSongMessage[]> {
  const { passphrase, env, profile, sampleRate } = opts;
  const ch = await deriveChannel(passphrase);
  const modem = createModem({ sampleRate, env, profile });
  const airs: Uint8Array[] = [];
  modem.onFrame((air) => airs.push(air.slice()));
  for (let i = 0; i < pcm.length; i += CHUNK) modem.push(pcm.subarray(i, Math.min(pcm.length, i + CHUNK)));
  modem.push(new Float32Array(Math.round(TRAILING_SILENCE_S * sampleRate)));

  const decoders = new Map<number, FountainDecoder>();
  const finished = new Set<number>();
  const out: DecodedSongMessage[] = [];
  for (const air of airs) {
    const r = decodeAirFrame(air);
    if (!r || r.frame.netTag !== ch.netTag) continue;
    const { msgId, k, seed, payload } = r.frame;
    if (finished.has(msgId)) continue;
    let dec = decoders.get(msgId);
    if (!dec || dec.k !== k) {
      dec = createFountainDecoder(k);
      decoders.set(msgId, dec);
    }
    dec.add(seed, payload);
    if (!dec.done) continue;
    const envelope = dec.envelope();
    if (!envelope) continue;
    if ((await msgIdOf(envelope)) !== msgId) continue;
    const opened = await openMessage(ch, envelope);
    if (!opened) continue;
    finished.add(msgId);
    decoders.delete(msgId);
    out.push({ msgId, text: opened.text, alias: opened.alias });
  }
  return out;
}
