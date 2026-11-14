import { describe, expect, it } from 'vitest';
import { createFakeModem } from './fakeModem.ts';
import { mulberry32, gaussian } from '../util/prng.ts';
import type { Modem } from '../types.ts';

function make(): { m: Modem; got: Uint8Array[] } {
  const m = createFakeModem({ sampleRate: 8000, env: 'quiet', profile: 'fast' });
  const got: Uint8Array[] = [];
  m.onFrame((b) => got.push(b));
  return { m, got };
}
function rand(seed: number): Uint8Array {
  const r = mulberry32(seed);
  return Uint8Array.from({ length: 32 }, () => Math.floor(r() * 256));
}
function feed(m: Modem, pcm: Float32Array, seed = 3) {
  const r = mulberry32(seed);
  for (let i = 0; i < pcm.length;) {
    const n = Math.min(pcm.length - i, 1 + Math.floor(r() * 500));
    m.push(pcm.subarray(i, i + n));
    i += n;
  }
}
function pad(pcm: Float32Array, lead: number, tail: number) {
  const o = new Float32Array(lead + pcm.length + tail);
  o.set(pcm, lead);
  return o;
}

describe('fakeModem', () => {
  it('round trips random bytes with random chunking', () => {
    const { m, got } = make();
    const air = rand(1);
    feed(m, pad(m.encode(air, 0), 100, 100));
    expect(got).toHaveLength(1);
    expect(Array.from(got[0]!)).toEqual(Array.from(air));
  });
  it('rejects wrong length', () => {
    const { m } = make();
    expect(() => m.encode(new Uint8Array(5), 0)).toThrow(RangeError);
  });
  it('busy during frame', () => {
    const { m } = make();
    const pcm = m.encode(rand(2), 0);
    m.push(pcm.subarray(0, 100));
    expect(m.busy()).toBe(true);
    m.push(pcm.subarray(100));
    expect(m.busy()).toBe(false);
  });
  it('drops overlapping frames', () => {
    const { m, got } = make();
    const p1 = m.encode(rand(1), 0);
    const p2 = m.encode(rand(2), 0);
    const mix = new Float32Array(p1.length + 300);
    for (let i = 0; i < p1.length; i++) mix[i]! += p1[i]!;
    for (let i = 0; i < p2.length; i++) mix[i + 100]! += p2[i]!;
    feed(m, mix);
    expect(got).toHaveLength(0);
  });
  it('emits back-to-back frames', () => {
    const { m, got } = make();
    const a = rand(1), b = rand(2);
    const p1 = m.encode(a, 0), p2 = m.encode(b, 0);
    const all = new Float32Array(p1.length + p2.length + 50);
    all.set(p1, 10);
    all.set(p2, 10 + p1.length);
    feed(m, all);
    expect(got).toHaveLength(2);
    expect(Array.from(got[1]!)).toEqual(Array.from(b));
  });
  it('handles scaled frame', () => {
    const { m, got } = make();
    const air = rand(5);
    const p = m.encode(air, 0).map((v) => v * 0.4);
    feed(m, pad(p, 50, 50));
    expect(got).toHaveLength(1);
    expect(Array.from(got[0]!)).toEqual(Array.from(air));
  });
  it('drops noisy frame', () => {
    const { m, got } = make();
    const p = m.encode(rand(6), 0);
    const r = mulberry32(9);
    for (let i = 0; i < p.length; i++) p[i]! += 0.01 * gaussian(r);
    feed(m, pad(p, 50, 50));
    expect(got).toHaveLength(0);
  });
});
