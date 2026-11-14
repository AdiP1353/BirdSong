import { afterAll, describe, expect, it } from 'vitest';
import { startEtherServer } from '../src/server.ts';
import { createEtherPort } from '../src/client.ts';

describe('ether', () => {
  const ports: ReturnType<typeof createEtherPort>[] = [];
  let server: Awaited<ReturnType<typeof startEtherServer>> | undefined;
  afterAll(async () => {
    for (const p of ports) await p.stop();
    await server?.close();
  });

  it('mixes by distance', async () => {
    server = await startEtherServer({ port: 0, noiseRms: 0, sampleRate: 48000, range: 1.2 });
    const url = `ws://127.0.0.1:${server.port}`;
    const mk = (id: number, x: number) => {
      const p = createEtherPort({ url, id, x, y: 0 });
      ports.push(p);
      return p;
    };
    const A = mk(1, 0), B = mk(2, 1), C = mk(3, 5);
    let bBest = 0, cBest = 0;
    const rms = (f: Float32Array) => { let s = 0; for (const v of f) s += v * v; return Math.sqrt(s / f.length); };
    B.onInput((f) => { bBest = Math.max(bBest, rms(f)); });
    C.onInput((f) => { cBest = Math.max(cBest, rms(f)); });
    A.onInput(() => {});
    await Promise.all([A.start(), B.start(), C.start()]);
    const n = 24000;
    const sine = new Float32Array(n);
    for (let i = 0; i < n; i++) sine[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000);
    const t0 = performance.now();
    const done = A.play(sine).then(() => performance.now() - t0);
    const elapsed = await done;
    await new Promise((r) => setTimeout(r, 300));
    expect(bBest).toBeGreaterThan(0.25);
    expect(bBest).toBeLessThan(0.45);
    expect(cBest).toBe(0);
    expect(elapsed).toBeGreaterThan(400);
    expect(elapsed).toBeLessThan(1200);
  }, 10000);
});
