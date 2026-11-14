import { describe, expect, it } from 'vitest';
import { createSimWorld } from './world.ts';
import { createFakeModem } from './fakeModem.ts';
import { parseTopology } from './topology.ts';

const opts = { sampleRate: 8000, env: 'quiet', profile: 'fast' } as const;

describe('sim world', () => {
  it('delivers a frame to a neighbour but not to the sender', async () => {
    const w = createSimWorld({ sampleRate: 8000 });
    const p0 = w.addPort({ x: 0, y: 0 });
    const p1 = w.addPort({ x: 1, y: 0 });
    const m0 = createFakeModem(opts), m1 = createFakeModem(opts);
    const g0: Uint8Array[] = [], g1: Uint8Array[] = [];
    m0.onFrame((b) => g0.push(b));
    m1.onFrame((b) => g1.push(b));
    p0.onInput((x) => m0.push(x));
    p1.onInput((x) => m1.push(x));
    await p0.start(); await p1.start();
    const air = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
    void p0.play(m0.encode(air, 0));
    await w.run(3500);
    expect(g1).toHaveLength(1);
    expect(Array.from(g1[0]!)).toEqual(Array.from(air));
    expect(g0).toHaveLength(0);
  });

  it('respects range', async () => {
    const w = createSimWorld({ sampleRate: 8000 });
    const ps = [0, 1, 2].map((x) => w.addPort({ x, y: 0 }));
    const peak = [0, 0, 0];
    ps.forEach((p, i) => { p.onInput((x) => { for (const v of x) peak[i] = Math.max(peak[i]!, Math.abs(v)); }); void p.start(); });
    void ps[0]!.play(new Float32Array(800).fill(0.5));
    await w.run(200);
    expect(peak[1]).toBeGreaterThan(0.4);
    expect(peak[2]).toBe(0);
  });

  it('manual topology overrides distance and can change live', async () => {
    const w = createSimWorld({ sampleRate: 8000, topology: parseTopology('0>2') });
    const ps = [0, 0.5, 9].map((x) => w.addPort({ x, y: 0 }));
    const peak = [0, 0, 0];
    ps.forEach((p, i) => { p.onInput((x) => { for (const v of x) peak[i] = Math.max(peak[i]!, Math.abs(v)); }); void p.start(); });
    void ps[0]!.play(new Float32Array(800).fill(0.5));
    await w.run(200);
    expect(peak[1]).toBe(0);
    expect(peak[2]).toBeGreaterThan(0.4);
    w.setTopology(parseTopology('0-1'));
    peak.fill(0);
    void ps[0]!.play(new Float32Array(800).fill(0.5));
    await w.run(200);
    expect(peak[1]).toBeGreaterThan(0.4);
    expect(peak[2]).toBe(0);
    w.setTopology(null);
    peak.fill(0);
    void ps[0]!.play(new Float32Array(800).fill(0.5));
    await w.run(200);
    expect(peak[1]).toBeGreaterThan(0.4);
    expect(peak[2]).toBe(0);
  });

  it('play resolves at audio duration', async () => {
    const w = createSimWorld({ sampleRate: 8000 });
    const p = w.addPort({ x: 0, y: 0 });
    let t = -1;
    void p.play(new Float32Array(4000)).then(() => { t = w.clock.now(); });
    await w.run(1000);
    expect(Math.abs(t - 500)).toBeLessThanOrEqual(20);
  });

  it('fires clock timers', async () => {
    const w = createSimWorld({ sampleRate: 8000 });
    let fired = false;
    w.clock.setTimeout(() => { fired = true; }, 500);
    await w.run(1000);
    expect(fired).toBe(true);
  });

  it('dead ports neither hear nor speak', async () => {
    const w = createSimWorld({ sampleRate: 8000 });
    const a = w.addPort({ x: 0, y: 0 });
    const b = w.addPort({ x: 1, y: 0 });
    const c = w.addPort({ x: 0.5, y: 0 });
    let bCalls = 0, cPeak = 0;
    b.onInput(() => { bCalls++; });
    c.onInput((x) => { for (const v of x) cPeak = Math.max(cPeak, Math.abs(v)); });
    await a.start(); await b.start(); await c.start();
    w.setAlive(1, false);
    void b.play(new Float32Array(800).fill(0.5));
    let resolved = false;
    void b.play(new Float32Array(800)).then(() => { resolved = true; });
    await w.run(500);
    expect(bCalls).toBe(0);
    expect(cPeak).toBe(0);
    expect(resolved).toBe(true);
  });

  it('runUntil semantics', async () => {
    const w = createSimWorld({ sampleRate: 8000 });
    expect(await w.runUntil(() => false, 200)).toBe(false);
    expect(w.clock.now()).toBe(200);
    expect(await w.runUntil(() => w.clock.now() >= 300, 10_000)).toBe(true);
    expect(w.clock.now()).toBe(300);
  });

  it('is deterministic', async () => {
    async function once() {
      const w = createSimWorld({ sampleRate: 8000, noiseRms: 0.05, seed: 9 });
      const a = w.addPort({ x: 0, y: 0 });
      const b = w.addPort({ x: 1, y: 0 });
      const chunks: number[] = [];
      b.onInput((x) => { for (const v of x) chunks.push(v); });
      await b.start();
      void a.play(new Float32Array(1600).fill(0.3));
      await w.run(400);
      return chunks;
    }
    expect(await once()).toEqual(await once());
  });

  it('is fast', async () => {
    const w = createSimWorld({ sampleRate: 8000 });
    for (let i = 0; i < 8; i++) { const p = w.addPort({ x: i * 0.5, y: 0 }); p.onInput(() => {}); await p.start(); }
    const t0 = Date.now();
    await w.run(60_000);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
