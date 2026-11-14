import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from './wav.ts';

describe('wav', () => {
  it('round trips a sine within quantisation error', () => {
    const pcm = new Float32Array(1000).map((_, i) => 0.8 * Math.sin((2 * Math.PI * 440 * i) / 48000));
    const bytes = encodeWav(pcm, 48000);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    const out = decodeWav(bytes);
    expect(out.sampleRate).toBe(48000);
    expect(out.pcm.length).toBe(1000);
    for (let i = 0; i < 1000; i++) expect(Math.abs(out.pcm[i]! - pcm[i]!)).toBeLessThan(1e-4);
  });
  it('rejects garbage', () => {
    expect(() => decodeWav(new Uint8Array(20))).toThrow('unsupported wav');
  });
});

describe('wav multichannel', () => {
  it('averages stereo to mono', () => {
    const mono = encodeWav(new Float32Array([0.5, -0.5]), 8000);
    // build a stereo header by hand: duplicate each sample into L/R
    const stereo = new Uint8Array(44 + 8);
    stereo.set(mono.slice(0, 44));
    const dv = new DataView(stereo.buffer);
    dv.setUint16(22, 2, true);
    dv.setUint16(32, 4, true);
    dv.setUint32(40, 8, true);
    dv.setInt16(44, 16384, true); dv.setInt16(46, 0, true);
    dv.setInt16(48, -16384, true); dv.setInt16(50, 0, true);
    const out = decodeWav(stereo);
    expect(out.pcm.length).toBe(2);
    expect(out.pcm[0]!).toBeCloseTo(0.25, 3);
    expect(out.pcm[1]!).toBeCloseTo(-0.25, 3);
  });
});
