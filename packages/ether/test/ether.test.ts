import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { parseTopology } from '@birdsong/core';
import { startEtherServer, topologyFromEnv } from '../src/server.ts';
import { createEtherPort } from '../src/client.ts';

const rms = (f: Float32Array) => { let s = 0; for (const v of f) s += v * v; return Math.sqrt(s / f.length); };
const sine = (n: number) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000));

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

  it('manual topology: only listed links carry sound, and PUT changes it live', async () => {
    const srv = await startEtherServer({
      port: 0, noiseRms: 0, sampleRate: 48000, range: 1.2,
      topology: parseTopology('1>3'), controlToken: 'secret',
    });
    const url = `ws://127.0.0.1:${srv.port}`;
    const http = `http://127.0.0.1:${srv.port}/topology`;
    const mine: ReturnType<typeof createEtherPort>[] = [];
    try {
      const mk = (id: number, x: number) => { const p = createEtherPort({ url, id, x, y: 0 }); mine.push(p); return p; };
      const A = mk(1, 0), B = mk(2, 0.5), C = mk(3, 9);
      let bBest = 0, cBest = 0;
      B.onInput((f) => { bBest = Math.max(bBest, rms(f)); });
      C.onInput((f) => { cBest = Math.max(cBest, rms(f)); });
      A.onInput(() => {});
      await Promise.all([A.start(), B.start(), C.start()]);
      await A.play(sine(9600));
      await new Promise((r) => setTimeout(r, 200));
      expect(bBest).toBe(0);
      expect(cBest).toBeGreaterThan(0.25);

      expect(await (await fetch(http)).json()).toEqual({ manual: true, text: '1>3', links: [[1, 3]] });
      const put = (body: unknown, token?: string) => fetch(http, {
        method: 'PUT', body: JSON.stringify(body),
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      expect((await put({ text: '1-2' })).status).toBe(401);
      expect((await put({ text: '1-2' }, 'wrong')).status).toBe(401);
      const bad = await put({ text: '1-999' }, 'secret');
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toMatch(/999/);
      const ok = await put({ text: '2-1' }, 'secret');
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ manual: true, text: '1-2', links: [[1, 2], [2, 1]] });

      bBest = 0; cBest = 0;
      await A.play(sine(9600));
      await new Promise((r) => setTimeout(r, 200));
      expect(bBest).toBeGreaterThan(0.25);
      expect(cBest).toBe(0);

      expect(await (await put({ text: '' }, 'secret')).json()).toEqual({ manual: false, text: '', links: [] });
    } finally {
      for (const p of mine) await p.stop();
      await srv.close();
    }
  }, 10000);

  it('refuses live edits when no control token is configured', async () => {
    const srv = await startEtherServer({ port: 0, noiseRms: 0 });
    try {
      const r = await fetch(`http://127.0.0.1:${srv.port}/topology`, { method: 'PUT', body: '{"text":"1-2"}' });
      expect(r.status).toBe(403);
      expect(await (await fetch(`http://127.0.0.1:${srv.port}/topology`)).json()).toMatchObject({ manual: false });
    } finally {
      await srv.close();
    }
  });

  it('reads the startup topology from the environment', () => {
    expect(topologyFromEnv({})).toBeNull();
    expect(topologyFromEnv({ ETHER_TOPOLOGY: '0-1' })!.links).toEqual([[0, 1], [1, 0]]);
    expect(topologyFromEnv({ ETHER_TOPOLOGY_FILE: '/nonexistent/topology.txt' })).toBeNull();
    expect(() => topologyFromEnv({ ETHER_TOPOLOGY: '0-1', ETHER_TOPOLOGY_FILE: '/x' })).toThrow(/not both/);
    expect(() => topologyFromEnv({ ETHER_TOPOLOGY: 'nope' })).toThrow(/nope/);
  });

  it('noise sources: token only, heard by every node whatever the topology, and by listeners unless noise=0', async () => {
    const srv = await startEtherServer({
      port: 0, noiseRms: 0, sampleRate: 48000, topology: parseTopology('1>3'), controlToken: 'secret',
    });
    const url = `ws://127.0.0.1:${srv.port}`;
    const http = `http://127.0.0.1:${srv.port}`;
    const mine: ReturnType<typeof createEtherPort>[] = [];
    const socks: WsClient[] = [];
    const openWs = (path: string, token?: string) => new Promise<{ ws: WsClient; closed: Promise<number>; best: () => number; reset: () => void }>((res, rej) => {
      const ws = new WsClient(`${url}${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
      socks.push(ws);
      let best = 0;
      const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
      ws.on('message', (d: Buffer) => {
        const f = new Float32Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
        if (f.length) best = Math.max(best, rms(f));
      });
      ws.on('open', () => res({ ws, closed, best: () => best, reset: () => { best = 0; } }));
      ws.on('error', rej);
    });
    const send = (ws: WsClient, f: Float32Array) => ws.send(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
    try {
      // 2 hears nobody in the topology, but noise is in the room, not on a link.
      const B = createEtherPort({ url, id: 2, x: 0, y: 0 });
      mine.push(B);
      let bBest = 0;
      B.onInput((f) => { bBest = Math.max(bBest, rms(f)); });
      await B.start();

      expect((await openWs('/noise').then((c) => c.closed))).toBe(1008);
      expect((await openWs('/noise', 'wrong').then((c) => c.closed))).toBe(1008);
      expect(await (await fetch(`${http}/noise`)).json()).toEqual({ sources: 0 });

      const withNoise = await openWs('/listen?x=0&y=0');
      const without = await openWs('/listen?x=0&y=0&noise=0');
      const src = await openWs('/noise', 'secret');
      await new Promise((r) => setTimeout(r, 50));
      expect(await (await fetch(`${http}/noise`)).json()).toEqual({ sources: 1 });
      send(src.ws, sine(9600));
      await new Promise((r) => setTimeout(r, 400));
      expect(bBest).toBeGreaterThan(0.25);
      expect(withNoise.best()).toBeGreaterThan(0.25);
      expect(without.best()).toBe(0);

      // A source that sends faster than real time is cut to a short queue, so noise never lags far behind.
      send(src.ws, sine(96000));
      await new Promise((r) => setTimeout(r, 700));
      bBest = 0;
      await new Promise((r) => setTimeout(r, 200));
      expect(bBest).toBe(0);

      src.ws.close();
      await src.closed;
      await new Promise((r) => setTimeout(r, 50));
      expect(await (await fetch(`${http}/noise`)).json()).toEqual({ sources: 0 });
    } finally {
      for (const s of socks) s.terminate();
      for (const p of mine) await p.stop();
      await srv.close();
    }
  }, 10000);

  it('refuses noise sources when no control token is configured', async () => {
    const srv = await startEtherServer({ port: 0, noiseRms: 0 });
    try {
      const code = await new Promise<number>((res, rej) => {
        const ws = new WsClient(`ws://127.0.0.1:${srv.port}/noise`, { headers: { authorization: 'Bearer x' } });
        ws.on('close', (c) => res(c));
        ws.on('error', rej);
      });
      expect(code).toBe(1008);
    } finally {
      await srv.close();
    }
  });
});
