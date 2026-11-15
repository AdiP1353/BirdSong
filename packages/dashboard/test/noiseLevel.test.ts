import { describe, expect, it } from 'vitest';
import { BIRD_RMS, ECHO_HANGOVER_MS, createChunker, createEchoGate, dbToGain, noiseVerdict, rmsOf, vsBirdsDb } from '../src/noiseLevel.ts';

describe('noise level helpers', () => {
  it('converts dB to gain and measures noise against a bird', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(20)).toBeCloseTo(10);
    expect(dbToGain(-20)).toBeCloseTo(0.1);
    expect(vsBirdsDb(BIRD_RMS)).toBeCloseTo(0);
    expect(vsBirdsDb(BIRD_RMS * 10)).toBeCloseTo(20);
    expect(vsBirdsDb(0)).toBe(-Infinity);
  });

  it('says what to expect at a level (thresholds from the room-noise tests)', () => {
    expect(noiseVerdict(-Infinity).tone).toBe('ok');
    expect(noiseVerdict(5).tone).toBe('ok');
    expect(noiseVerdict(12).tone).toBe('warn');
    expect(noiseVerdict(20).tone).toBe('bad');
  });

  it('cuts any input into fixed blocks with gain applied and reports their RMS', () => {
    const out: Float32Array[] = [];
    const levels: number[] = [];
    const c = createChunker(4, (b, rms) => { out.push(b); levels.push(rms); });
    c.gain = 2;
    c.push(new Float32Array([1, 1, 1]));
    expect(out.length).toBe(0);
    c.push(new Float32Array([1, -1, -1, -1, -1, 0.5]));
    expect(out.map((b) => Array.from(b))).toEqual([[2, 2, 2, 2], [-2, -2, -2, -2]]);
    expect(levels).toEqual([2, 2]);
    c.push(new Float32Array([0.5]));
    expect(out.length).toBe(2);
    c.reset();
    c.push(new Float32Array([1, 1, 1, 1]));
    expect(Array.from(out[2]!)).toEqual([2, 2, 2, 2]);
  });

  it('clamps samples so a howling microphone cannot blow up the ether', () => {
    const out: Float32Array[] = [];
    const c = createChunker(2, (b) => out.push(b));
    c.gain = 100;
    c.push(new Float32Array([0.5, -0.5]));
    expect(Array.from(out[0]!)).toEqual([4, -4]);
  });
});

describe('resampler', () => {
  it('keeps the frequency of a tone and the stream length, across any chunking', async () => {
    const { createResampler } = await import('../src/noiseLevel.ts');
    const from = 44_100;
    const r = createResampler(from, 48_000);
    const x = Float32Array.from({ length: from }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / from));
    const parts: Float32Array[] = [];
    for (let at = 0; at < x.length; at += 128) parts.push(r.push(x.subarray(at, Math.min(x.length, at + 128))));
    const y = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { y.set(p, o); o += p.length; }
    expect(Math.abs(y.length - 48_000)).toBeLessThanOrEqual(2);
    // Compare with the ideal 1 kHz tone at 48 kHz.
    let err = 0;
    for (let i = 0; i < y.length - 2; i++) err = Math.max(err, Math.abs(y[i]! - Math.sin((2 * Math.PI * 1000 * i) / 48_000)));
    expect(err).toBeLessThan(0.02);
  });

  it('passes samples through when the rates match', async () => {
    const { createResampler } = await import('../src/noiseLevel.ts');
    const r = createResampler(48_000, 48_000);
    expect(Array.from(r.push(new Float32Array([1, 2, 3])))).toEqual([1, 2, 3]);
  });

  it('shuts the echo gate while a bird plays and for the hangover after, but not for the hiss', () => {
    const g = createEchoGate();
    expect(g.open(0)).toBe(true);
    g.played(0.002, 1000); // the ether's own hiss
    expect(g.open(500)).toBe(true);
    g.played(BIRD_RMS, 1000); // a bird, playing until t = 1000 ms
    expect(g.open(500)).toBe(false);
    expect(g.open(1000 + ECHO_HANGOVER_MS - 1)).toBe(false);
    expect(g.open(1000 + ECHO_HANGOVER_MS)).toBe(true);
    g.played(BIRD_RMS, 900); // an earlier end never reopens it sooner
    g.played(BIRD_RMS, 2000);
    expect(g.open(2400)).toBe(false);
    expect(rmsOf(new Float32Array([3, -3, 3, -3]))).toBe(3);
    expect(rmsOf(new Float32Array(0))).toBe(0);
  });
});
