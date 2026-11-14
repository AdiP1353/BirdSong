import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { DEFAULT_NODE_CONFIG } from '@birdsong/core';
import type { Command, HubToUi, TelemetryEvent } from '@birdsong/core';
import { startHub } from '../src/server/hub.ts';

let hub: Awaited<ReturnType<typeof startHub>>;
beforeEach(async () => {
  hub = await startHub({ port: 0, distDir: '/nonexistent-dist' });
});
afterEach(async () => {
  await hub.close();
});

function open(path: string): Promise<{ ws: WebSocket; msgs: string[] }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}${path}`);
    const msgs: string[] = [];
    ws.on('message', (d) => msgs.push(d.toString()));
    ws.on('open', () => res({ ws, msgs }));
    ws.on('error', rej);
  });
}
const until = async (fn: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(fn()).toBe(true);
};
const hello = (node: number): TelemetryEvent => ({
  type: 'hello', node, species: 0, kind: 'sim', config: { ...DEFAULT_NODE_CONFIG }, t: 5,
});

describe('hub', () => {
  it('snapshot lists announced and inferred nodes; stamps t', async () => {
    const n = await open('/node');
    n.ws.send(JSON.stringify(hello(1)));
    n.ws.send(JSON.stringify({ type: 'heard', node: 1, from: 130, msgId: 1, seed: 0, hop: 0, k: 2, sync: 0.5, t: 5 }));
    await new Promise((r) => setTimeout(r, 150));
    const ui = await open('/ui');
    await until(() => ui.msgs.length > 0);
    const snap = JSON.parse(ui.msgs[0]!) as Extract<HubToUi, { type: 'snapshot' }>;
    expect(snap.type).toBe('snapshot');
    expect(snap.nodes.map((x) => [x.node, x.kind])).toEqual([[1, 'sim'], [130, 'browser']]);
    expect(snap.join.passphrase).toBe('demo-flock');
    for (const e of snap.recent) expect(Math.abs(e.t - Date.now())).toBeLessThan(1000);
    n.ws.close();
    ui.ws.close();
  });

  it('forwards live events with a hub timestamp', async () => {
    const ui = await open('/ui');
    const n = await open('/node');
    n.ws.send(JSON.stringify(hello(1)));
    await until(() => ui.msgs.length >= 2);
    const m = JSON.parse(ui.msgs[1]!) as Extract<HubToUi, { type: 'event' }>;
    expect(m.event.t).not.toBe(5);
    expect(Math.abs(m.event.t - Date.now())).toBeLessThan(1000);
    n.ws.close();
    ui.ws.close();
  });

  it('routes commands to one node or all', async () => {
    const a = await open('/node');
    const b = await open('/node');
    const c = await open('/node');
    a.ws.send(JSON.stringify(hello(1)));
    b.ws.send(JSON.stringify(hello(3)));
    c.ws.send(JSON.stringify(hello(4)));
    const ui = await open('/ui');
    await new Promise((r) => setTimeout(r, 150));
    const one: Command = { type: 'configure', node: 3, patch: { muted: true } };
    ui.ws.send(JSON.stringify(one));
    await until(() => b.msgs.length === 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(a.msgs).toHaveLength(0);
    expect(c.msgs).toHaveLength(0);
    expect(JSON.parse(b.msgs[0]!)).toEqual(one);
    ui.ws.send(JSON.stringify({ type: 'configure', node: 'all', patch: { camouflage: true } }));
    await until(() => a.msgs.length === 1 && b.msgs.length === 2 && c.msgs.length === 1);
    for (const x of [a, b, c, ui]) x.ws.close();
  });

  it('sends nodeOffline when a node closes', async () => {
    const ui = await open('/ui');
    const n = await open('/node');
    n.ws.send(JSON.stringify(hello(9)));
    await until(() => ui.msgs.length >= 2);
    n.ws.close();
    await until(() => ui.msgs.some((m) => (JSON.parse(m) as HubToUi).type === 'nodeOffline'));
    expect(JSON.parse(ui.msgs.at(-1)!)).toEqual({ type: 'nodeOffline', node: 9 });
    ui.ws.close();
  });

  it('serves a notice when dist is missing and config.json', async () => {
    const r = await fetch(`http://127.0.0.1:${hub.port}/`);
    expect(await r.text()).toContain('not built');
    const c = await (await fetch(`http://127.0.0.1:${hub.port}/config.json`)).json();
    expect(c).toEqual({ etherUrl: null, proxyUrl: null, topologyEditable: false });
  });

  const restart = async (extra: Parameters<typeof startHub>[0]): Promise<void> => {
    await hub.close();
    hub = await startHub({ port: 0, distDir: '/nonexistent-dist', ...extra });
  };
  const getLog = async (q = ''): Promise<{ entries: Array<{ seq: number; kind: string }>; next: number }> =>
    (await fetch(`http://127.0.0.1:${hub.port}/api/log${q}`)).json() as never;
  const untilLog = async (n: number): Promise<void> => {
    for (let i = 0; i < 100 && (await getLog()).entries.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    expect((await getLog()).entries.length).toBeGreaterThanOrEqual(n);
  };

  it('config.json carries proxyUrl', async () => {
    await restart({ proxyUrl: 'http://localhost:3100' });
    const c = await (await fetch(`http://127.0.0.1:${hub.port}/config.json`)).json();
    expect(c).toEqual({ etherUrl: null, proxyUrl: 'http://localhost:3100', topologyEditable: false });
  });

  it('/api/log records events, commands and offline in order', async () => {
    const n = await open('/node');
    n.ws.send(JSON.stringify(hello(1)));
    n.ws.send(JSON.stringify({ type: 'heard', node: 1, from: 130, msgId: 1, seed: 0, hop: 0, k: 2, sync: 0.5, t: 5 }));
    await untilLog(2);
    const ui = await open('/ui');
    ui.ws.send(JSON.stringify({ type: 'configure', node: 1, patch: { muted: true } }));
    await untilLog(3);
    n.ws.close();
    await untilLog(4);
    const all = await getLog();
    expect(all.entries.map((e) => e.kind)).toEqual(['event', 'event', 'command', 'offline']);
    expect(all.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    const since = await getLog('?since=2');
    expect(since.entries.map((e) => e.seq)).toEqual([3, 4]);
    expect(since.next).toBe(4);
    expect((await getLog('?limit=1')).entries).toHaveLength(1);
    expect(await getLog('?since=99')).toEqual({ entries: [], next: 99 });
    ui.ws.close();
  });

  it('/app serves the web app', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bs-dist-'));
    writeFileSync(join(dir, 'index.html'), '<p>app</p>');
    writeFileSync(join(dir, 'manifest.webmanifest'), '{}');
    await restart({ webDistDir: dir });
    const base = `http://127.0.0.1:${hub.port}`;
    const redirect = await fetch(`${base}/app`, { redirect: 'manual' });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe('/app/');
    expect(await (await fetch(`${base}/app/`)).text()).toBe('<p>app</p>');
    expect((await fetch(`${base}/app/manifest.webmanifest`)).headers.get('content-type')).toBe('application/manifest+json');
    expect((await fetch(`${base}/app/..%2f..%2fpackage.json`)).status).toBe(400);
    expect((await fetch(`${base}/app/missing.js`)).status).toBe(404);
    expect(await (await fetch(`${base}/`)).text()).toContain('not built');
  });

  it('/app without a build says how to build it', async () => {
    await restart({ webDistDir: '/nonexistent-web' });
    expect(await (await fetch(`http://127.0.0.1:${hub.port}/app/`)).text()).toContain('npm run build -w @birdsong/web');
  });

  it('writes the log file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bs-log-'));
    const file = join(dir, 'logs', 'i.ndjson');
    await restart({ logFile: file });
    const n = await open('/node');
    n.ws.send(JSON.stringify(hello(2)));
    await until(() => existsSync(file) && readFileSync(file, 'utf8').includes('"hello"'));
    const first = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!);
    expect(first.kind).toBe('event');
    expect(first.data.node).toBe(2);
    n.ws.close();
  });

  it('relays topology changes to the ether, logs them and tells every dashboard tab', async () => {
    const seen: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[] = [];
    const fake = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(req.method === 'PUT'
          ? JSON.stringify({ manual: true, text: '0-1', links: [[0, 1], [1, 0]] })
          : JSON.stringify({ manual: false, text: '', links: [] }));
      });
    });
    await new Promise<void>((r) => fake.listen(0, r));
    const fakePort = (fake.address() as { port: number }).port;
    try {
      await restart({ etherControlUrl: `http://127.0.0.1:${fakePort}/`, etherControlToken: 'tok' });
      const base = `http://127.0.0.1:${hub.port}`;
      expect(await (await fetch(`${base}/config.json`)).json()).toMatchObject({ topologyEditable: true });
      expect(await (await fetch(`${base}/api/topology`)).json()).toEqual({ manual: false, text: '', links: [] });
      const ui = await open('/ui');
      await until(() => ui.msgs.length > 0);
      const r = await fetch(`${base}/api/topology`, { method: 'PUT', body: JSON.stringify({ text: '0-1' }) });
      expect(r.status).toBe(200);
      const put = seen.find((x) => x.method === 'PUT')!;
      expect(put.url).toBe('/topology');
      expect(put.headers.authorization).toBe('Bearer tok');
      expect(JSON.parse(put.body)).toEqual({ text: '0-1' });
      await until(() => ui.msgs.some((m) => JSON.parse(m).type === 'topology'));
      const msg = ui.msgs.map((m) => JSON.parse(m) as HubToUi).find((m) => m.type === 'topology')!;
      expect(msg).toEqual({ type: 'topology', topology: { manual: true, text: '0-1', links: [[0, 1], [1, 0]] } });
      const log = await (await fetch(`${base}/api/log`)).json() as { entries: { kind: string; data: unknown }[] };
      expect(log.entries.find((e) => e.kind === 'topology')?.data).toEqual({ manual: true, text: '0-1' });
      ui.ws.close();
    } finally {
      await new Promise<void>((r) => fake.close(() => r()));
    }
  });

  it('topology API is unavailable without an ether control URL', async () => {
    const base = `http://127.0.0.1:${hub.port}`;
    expect(await (await fetch(`${base}/config.json`)).json()).toMatchObject({ topologyEditable: false });
    expect((await fetch(`${base}/api/topology`)).status).toBe(503);
    expect((await fetch(`${base}/api/topology`, { method: 'PUT', body: '{"text":""}' })).status).toBe(503);
  });
});
