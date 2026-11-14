import { expect, it } from 'vitest';
import { mulberry32 } from '../util/prng.ts';
import {
  createFountainDecoder, decodeAirFrame, deriveChannel, encodeAirFrame, makeDroplet, msgIdOf, openMessage,
  sealMessage, splitBlocks,
} from './index.ts';

it('text survives encrypt, fountain, corruption and loss', async () => {
  const r = mulberry32(2024);
  const ri = (n: number) => Math.floor(r() * n);
  const ch = await deriveChannel('pipeline');
  for (let t = 0; t < 50; t++) {
    const len = 1 + ri(140);
    const text = Array.from({ length: len }, () => String.fromCharCode(32 + ri(95))).join('');
    const env = await sealMessage(ch, text, 'bird');
    const blocks = splitBlocks(env);
    const k = blocks.length;
    const msgId = await msgIdOf(env);
    const seeds = new Set<number>();
    while (seeds.size < 2 * k) seeds.add(ri(255));
    const frames = [...seeds].map((seed) => {
      const air = encodeAirFrame({
        netTag: ch.netTag, msgId, k, hop: 0, seed, sender: 1, payload: makeDroplet(blocks, seed),
      });
      for (let c = 0; c < 3; c++) {
        const p = ri(32);
        air[p] = air[p]! ^ (1 + ri(255));
      }
      return air;
    });
    // keep a random k
    for (let i = frames.length - 1; i > 0; i--) {
      const j = ri(i + 1);
      [frames[i], frames[j]] = [frames[j]!, frames[i]!];
    }
    const dec = createFountainDecoder(k);
    for (const air of frames.slice(0, k)) {
      const d = decodeAirFrame(air);
      expect(d).not.toBeNull();
      expect(d!.frame.msgId).toBe(msgId);
      dec.add(d!.frame.seed, d!.frame.payload);
    }
    const out = dec.envelope();
    expect(out).not.toBeNull();
    expect(await msgIdOf(out!)).toBe(msgId);
    expect((await openMessage(ch, out!))?.text).toBe(text);
  }
});
