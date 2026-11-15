import { describe, expect, it } from 'vitest';
import { deriveChannel, encodeAirFrame, makeDroplet, msgIdOf, sealMessage, splitBlocks, toHex } from '@birdsong/core';
import type { TelemetryEvent } from '@birdsong/core';
import { scramble, spyCapture, tryPassphrase } from '../src/spy.ts';

async function sung(text: string, seeds: number[]): Promise<{ msgId: number; events: TelemetryEvent[] }> {
  const ch = await deriveChannel('demo-flock');
  const envelope = await sealMessage(ch, text, 'ada');
  const msgId = await msgIdOf(envelope);
  const blocks = splitBlocks(envelope);
  const events = seeds.map((seed, i): TelemetryEvent => ({
    type: 'sang', node: i % 2, msgId, seed, hop: 0, k: blocks.length, durationMs: 3000, t: i,
    airHex: toHex(encodeAirFrame({ netTag: ch.netTag, msgId, k: blocks.length, hop: 0, seed, sender: i % 2, payload: makeDroplet(blocks, seed) })),
  }));
  return { msgId, events };
}

describe('spy view', () => {
  it('rebuilds the sealed envelope from the air but opens it only with the right passphrase', async () => {
    const { msgId, events } = await sung('the eagle lands at noon, bring the maps', [0, 1, 2, 3, 4, 5, 6, 7]);
    expect(spyCapture(events, null)).toBeNull();
    expect(spyCapture(events, msgId + 1)).toBeNull();
    const cap = spyCapture([...events, events[0]!], msgId)!;
    expect(cap.frames).toBe(8);
    expect(cap.senders).toEqual([0, 1]);
    expect(cap.envelope).not.toBeNull();
    const garbled = scramble(cap.ciphertext);
    expect(garbled.length).toBe(cap.ciphertext.length);
    expect(garbled).not.toContain('eagle');
    expect(await tryPassphrase(cap.envelope!, 'password123')).toBeNull();
    expect(await tryPassphrase(cap.envelope!, 'demo-flock')).toEqual({ text: 'the eagle lands at noon, bring the maps', alias: 'ada' });
  });

  it('with too few frames there is no envelope yet, only raw payload bytes', async () => {
    const { msgId, events } = await sung('the eagle lands at noon, bring the maps', [0]);
    const cap = spyCapture(events, msgId)!;
    expect(cap.frames).toBe(1);
    expect(cap.k).toBeGreaterThan(1);
    expect(cap.envelope).toBeNull();
    expect(cap.ciphertext.length).toBe(16);
  });
});
