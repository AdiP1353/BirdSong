import { describe, expect, it } from 'vitest';
import { createFloatChunker, createPulsePort } from '../src/pulsePort.ts';

function bytesOf(samples: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(samples).buffer);
}

describe('createFloatChunker', () => {
  it('reassembles samples from chunks of 1, 3, 5 and 4096 bytes', () => {
    const samples = Array.from({ length: 3000 }, (_, i) => Math.fround(Math.sin(i / 7)));
    const all = bytesOf(samples);
    for (const size of [1, 3, 5, 4096]) {
      const ch = createFloatChunker();
      const out: number[] = [];
      for (let o = 0; o < all.length; o += size) {
        for (const f of ch.push(all.subarray(o, Math.min(o + size, all.length)))) out.push(...f);
      }
      expect(out).toEqual(samples);
    }
  });
  it('handles unaligned Buffer views', () => {
    const ch = createFloatChunker();
    const big = Buffer.concat([Buffer.from([9]), Buffer.from(bytesOf([0.5, -0.25]))]);
    const out = ch.push(big.subarray(1));
    expect(Array.from(out[0]!)).toEqual([0.5, -0.25]);
  });
});

const live = process.env['BIRDSONG_PULSE_TEST'] === '1';
describe('pulse port (live audio)', () => {
  (live ? it : it.skip)('plays a tone and receives input', async () => {
    const port = createPulsePort();
    let got = 0;
    port.onInput((p) => { got += p.length; });
    await port.start();
    const tone = new Float32Array(24000).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 1000 * i) / 48000));
    await port.play(tone);
    await port.stop();
    expect(got).toBeGreaterThan(0);
  });
});
