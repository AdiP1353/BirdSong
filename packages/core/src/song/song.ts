import { decodeAirFrame, deriveChannel, encodeAirFrame, makeDroplet, msgIdOf, sealMessage, splitBlocks } from '../codec/index.ts';
import { createModem } from '../modem/index.ts';
import type { SongOptions } from './index.ts';

const LEAD_SILENCE_S = 0.5;
const GAP_SILENCE_S = 0.4;
const EXTRA_DROPLETS = 2;

/** Seeds for a song of `k` blocks: 0, 37, 74, ... (mod 255), k + 2 of them. */
export function songSeeds(k: number): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < k + EXTRA_DROPLETS; i++) seeds.push((i * 37) % 255);
  return seeds;
}

export async function renderMessageSong(
  opts: SongOptions & { text: string; alias: string; species: number; sender: number },
): Promise<Float32Array> {
  const { passphrase, env, profile, sampleRate, text, alias, species, sender } = opts;
  const ch = await deriveChannel(passphrase);
  const envelope = await sealMessage(ch, text, alias);
  const msgId = await msgIdOf(envelope);
  const blocks = splitBlocks(envelope);
  const k = blocks.length;
  const modem = createModem({ sampleRate, env, profile });

  const frames: Float32Array[] = [];
  for (const seed of songSeeds(k)) {
    const air = encodeAirFrame({ netTag: ch.netTag, msgId, k, hop: 0, seed, sender, payload: makeDroplet(blocks, seed) });
    // sanity: the frame must be decodable before we put it on air
    if (!decodeAirFrame(air)) throw new Error('internal error: frame does not decode');
    frames.push(modem.encode(air, species));
  }

  const lead = Math.round(LEAD_SILENCE_S * sampleRate);
  const gap = Math.round(GAP_SILENCE_S * sampleRate);
  let total = lead;
  for (const f of frames) total += f.length + (f === frames[frames.length - 1] ? lead : gap);
  const out = new Float32Array(total);
  let pos = lead;
  for (let i = 0; i < frames.length; i++) {
    out.set(frames[i]!, pos);
    pos += frames[i]!.length + (i === frames.length - 1 ? lead : gap);
  }
  return out;
}
