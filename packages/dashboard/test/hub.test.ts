import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { DEFAULT_NODE_CONFIG, formatTopology, parseTopology } from '@birdsong/core';
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

  it('disabling cuts off every node, refuses new ones and drops commands; enabling lets them back', async () => {
    const ui = await open('/ui');
    const n = await open('/node');
    n.ws.send(JSON.stringify(hello(2)));
    await until(() => ui.msgs.length >= 2);
    const closed = new Promise<void>((r) => n.ws.on('close', () => r()));
    const post = (disabled: unknown) => fetch(`http://127.0.0.1:${hub.port}/api/disabled`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabled }),
    });
    expect((await post('yes')).status).toBe(400);
    expect(await (await post(true)).json()).toEqual({ disabled: true });
    await closed;
    await until(() => ui.msgs.some((m) => (JSON.parse(m) as HubToUi).type === 'disabled'));
    await expect(open('/node')).rejects.toThrow();
    const late = await open('/ui');
    await until(() => late.msgs.length > 0);
    expect((JSON.parse(late.msgs[0]!) as Extract<HubToUi, { type: 'snapshot' }>).disabled).toBe(true);
    expect(await (await fetch(`http://127.0.0.1:${hub.port}/api/disabled`)).json()).toEqual({ disabled: true });
    expect(await (await post(false)).json()).toEqual({ disabled: false });
    const back = await open('/node');
    back.ws.send(JSON.stringify(hello(2)));
    ui.ws.send(JSON.stringify({ type: 'configure', node: 2, patch: { muted: true } }));
    await until(() => back.msgs.length === 1);
    for (const x of [ui, late, back]) x.ws.close();
  });

  it('stop mutes every bird, including ones that connect later; start unmutes them', async () => {
    const base = `http://127.0.0.1:${hub.port}`;
    const ui = await open('/ui');
    await until(() => ui.msgs.length > 0);
    expect((JSON.parse(ui.msgs[0]!) as Extract<HubToUi, { type: 'snapshot' }>).stopped).toBe(false);
    const a = await open('/node');
    a.ws.send(JSON.stringify(hello(1)));
    await until(() => ui.msgs.length >= 2);
    const post = (stopped: unknown) => fetch(`${base}/api/stopped`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stopped }),
    });
    expect((await post('yes')).status).toBe(400);
    expect(await (await post(true)).json()).toEqual({ stopped: true });
    const mute = { type: 'configure', node: 'all', patch: { muted: true } };
    await until(() => a.msgs.length === 1);
    expect(JSON.parse(a.msgs[0]!)).toEqual(mute);
    await until(() => ui.msgs.some((m) => { const x = JSON.parse(m) as HubToUi; return x.type === 'stopped' && x.stopped; }));
    expect(await (await fetch(`${base}/api/stopped`)).json()).toEqual({ stopped: true });

    // A bird that joins (or comes back) while stopped is muted as soon as it says hello.
    const b = await open('/node');
    b.ws.send(JSON.stringify(hello(2)));
    await until(() => b.msgs.length === 1);
    expect(JSON.parse(b.msgs[0]!)).toEqual(mute);
    const late = await open('/ui');
    await until(() => late.msgs.length > 0);
    expect((JSON.parse(late.msgs[0]!) as Extract<HubToUi, { type: 'snapshot' }>).stopped).toBe(true);

    expect(await (await post(false)).json()).toEqual({ stopped: false });
    await until(() => a.msgs.length === 2 && b.msgs.length === 2);
    expect(JSON.parse(a.msgs[1]!)).toEqual({ type: 'configure', node: 'all', patch: { muted: false } });
    const log = await (await fetch(`${base}/api/log`)).json() as { entries: { kind: string; data: unknown }[] };
    expect(log.entries.filter((e) => e.kind === 'stopped').map((e) => e.data)).toEqual([{ stopped: true }, { stopped: false }]);

    // While the dashboard is off the hub cannot reach the birds, so stop is refused.
    await fetch(`${base}/api/disabled`, { method: 'POST', body: JSON.stringify({ disabled: true }) });
    expect((await post(true)).status).toBe(409);
    for (const x of [ui, late, a, b]) x.ws.close();
  });

  it('serves a notice when dist is missing and config.json', async () => {
    const r = await fetch(`http://127.0.0.1:${hub.port}/`);
    expect(await r.text()).toContain('not built');
    const c = await (await fetch(`http://127.0.0.1:${hub.port}/config.json`)).json();
    expect(c).toEqual({ etherUrl: null, proxyUrl: null, topologyEditable: false, flockEditable: false, noiseEditable: false, speechToText: false });
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
    expect(c).toEqual({ etherUrl: null, proxyUrl: 'http://localhost:3100', topologyEditable: false, flockEditable: false, noiseEditable: false, speechToText: false });
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

  it('adds and removes birds through the nursery and keeps the topology in step', async () => {
    // A fake ether that keeps its topology, and a fake nursery that records calls.
    let topo = parseTopology('0-1\n1-2');
    const view = () => ({ manual: topo !== null, text: formatTopology(topo), links: topo ? topo.links.map(([a, b]) => [a, b]) : [] });
    const ether = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        if (req.method === 'PUT') topo = parseTopology((JSON.parse(body) as { text: string }).text);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(view()));
      });
    });
    const calls: string[] = [];
    const nurse = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString(); });
      req.on('end', () => {
        calls.push(`${req.method} ${req.url} ${req.headers.authorization} ${body}`);
        const created = req.method === 'POST';
        res.writeHead(created ? 201 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(created ? { id: (JSON.parse(body) as { id: number }).id, started: 'new' } : { removed: true }));
      });
    });
    await Promise.all([ether, nurse].map((x) => new Promise<void>((r) => x.listen(0, r))));
    const portOf = (x: typeof ether) => (x.address() as { port: number }).port;
    try {
      await restart({
        etherControlUrl: `http://127.0.0.1:${portOf(ether)}`, etherControlToken: 'tok',
        nurseryUrl: `http://127.0.0.1:${portOf(nurse)}`, nurseryToken: 'ntok',
      });
      const base = `http://127.0.0.1:${hub.port}`;
      expect(await (await fetch(`${base}/config.json`)).json()).toMatchObject({ flockEditable: true });
      const nodes = await Promise.all([0, 1, 2].map(async (i) => {
        const n = await open('/node');
        n.ws.send(JSON.stringify({ ...hello(i), kind: 'container' }));
        return n;
      }));
      const ui = await open('/ui');
      await new Promise((r) => setTimeout(r, 100));

      const post = (body: unknown) => fetch(`${base}/api/birds`, { method: 'POST', body: JSON.stringify(body) });
      expect((await post({ links: [] })).status).toBe(400); // manual topology: needs a link
      expect((await post({ id: 1, links: [0] })).status).toBe(409); // already in the flock
      const added = await post({ links: [2, 0] });
      expect(added.status).toBe(201);
      expect(await added.json()).toEqual({ id: 3, links: [2, 0] });
      expect(calls[0]).toMatch(/^POST \/birds Bearer ntok /);
      expect(JSON.parse(calls[0]!.split(' ').slice(4).join(' '))).toMatchObject({ id: 3, x: 3, y: 0, env: 'quiet' });
      expect(formatTopology(topo)).toBe('0-1\n0-3\n1-2\n2-3');

      const removed = await fetch(`${base}/api/birds/1`, { method: 'DELETE' });
      expect(removed.status).toBe(200);
      expect(calls[1]).toMatch(/^DELETE \/birds\/1 Bearer ntok/);
      expect(formatTopology(topo)).toBe('0-3\n2-3');
      await until(() => ui.msgs.some((m) => JSON.parse(m).type === 'nodeRemoved'));
      // Frames still in the air from bird 1 must not bring it back as a phone.
      nodes[0]!.ws.send(JSON.stringify({ type: 'heard', node: 0, from: 1, msgId: 1, seed: 0, hop: 0, k: 2, sync: 0.5, t: 5 }));
      await new Promise((r) => setTimeout(r, 100));
      const late = await open('/ui');
      await until(() => late.msgs.length > 0);
      const snap = JSON.parse(late.msgs[0]!) as Extract<HubToUi, { type: 'snapshot' }>;
      expect(snap.nodes.map((n) => n.node)).toEqual([0, 2]);
      const log = await (await fetch(`${base}/api/log`)).json() as { entries: { kind: string; data: unknown }[] };
      expect(log.entries.filter((e) => e.kind === 'flock').map((e) => e.data)).toEqual([{ added: 3, links: [2, 0] }, { removed: 1 }]);
      for (const x of [...nodes, ui, late]) x.ws.close();
    } finally {
      await Promise.all([ether, nurse].map((x) => new Promise<void>((r) => x.close(() => r()))));
    }
  });

  it('relays a dashboard noise source to the ether with the control token, and tells every tab', async () => {
    // A fake ether that accepts /noise sockets and records what arrives.
    const fake = createServer((_req, res) => { res.writeHead(404).end(); });
    const wss = new WebSocketServer({ server: fake });
    const got: { auth: string | undefined; bytes: number[] }[] = [];
    const etherSockets: WebSocket[] = [];
    wss.on('connection', (ws, req) => {
      etherSockets.push(ws);
      const rec = { auth: req.headers.authorization, path: req.url, bytes: [] as number[] };
      got.push(rec);
      ws.on('message', (d: Buffer, isBinary) => { if (isBinary) rec.bytes.push(...d); });
    });
    await new Promise<void>((r) => fake.listen(0, r));
    const fakePort = (fake.address() as { port: number }).port;
    try {
      await restart({ etherControlUrl: `http://127.0.0.1:${fakePort}`, etherControlToken: 'tok' });
      const base = `http://127.0.0.1:${hub.port}`;
      expect(await (await fetch(`${base}/config.json`)).json()).toMatchObject({ noiseEditable: true });
      const ui = await open('/ui');
      await until(() => ui.msgs.length > 0);
      expect((JSON.parse(ui.msgs[0]!) as Extract<HubToUi, { type: 'snapshot' }>).noiseSources).toBe(0);

      const src = await open('/noise');
      await until(() => got.length === 1);
      expect(got[0]!.auth).toBe('Bearer tok');
      src.ws.send(JSON.stringify({ source: 'mic', level: 4 }));
      const pcm = new Float32Array([0.25, -0.5, 0.125]);
      src.ws.send(new Uint8Array(pcm.buffer));
      await until(() => got[0]!.bytes.length === 12);
      expect(Array.from(new Float32Array(new Uint8Array(got[0]!.bytes).buffer))).toEqual([0.25, -0.5, 0.125]);
      await until(() => ui.msgs.some((m) => { const x = JSON.parse(m) as HubToUi; return x.type === 'noise' && x.sources === 1; }));

      src.ws.close();
      await until(() => ui.msgs.some((m) => { const x = JSON.parse(m) as HubToUi; return x.type === 'noise' && x.sources === 0; }));
      await until(() => etherSockets[0]!.readyState === WebSocket.CLOSED);
      const log = await (await fetch(`${base}/api/log`)).json() as { entries: { kind: string; data: unknown }[] };
      expect(log.entries.filter((e) => e.kind === 'noise').map((e) => e.data)).toEqual([
        { sources: 1 }, { source: 'mic', level: 4 }, { sources: 0 },
      ]);
      ui.ws.close();
    } finally {
      for (const ws of etherSockets) ws.terminate();
      wss.close();
      await new Promise<void>((r) => fake.close(() => r()));
    }
  });

  it('gives a phone one edge when it joins, relays the room as the phone\'s node, and drops the edge when it leaves', async () => {
    // A fake ether: keeps its topology, and on /node sends back whatever arrives (and records the path).
    let text = '0-1\n1-2';
    const paths: string[] = [];
    const fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        if (req.method === 'PUT') text = formatTopology(parseTopology((JSON.parse(Buffer.concat(chunks).toString()) as { text: string }).text));
        const t = parseTopology(text);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ manual: t !== null, text, links: t ? t.links : [] }));
      });
    });
    const wss = new WebSocketServer({ server: fake });
    wss.on('connection', (ws, req) => {
      paths.push(req.url ?? '');
      ws.on('message', (d: Buffer, isBinary) => { if (isBinary) ws.send(d, { binary: true }); });
    });
    await new Promise<void>((r) => fake.listen(0, r));
    const fakePort = (fake.address() as { port: number }).port;
    try {
      await restart({ etherControlUrl: `http://127.0.0.1:${fakePort}`, etherControlToken: 'tok' });
      const birds = [await open('/node'), await open('/node')];
      birds[0]!.ws.send(JSON.stringify(hello(1)));
      birds[1]!.ws.send(JSON.stringify(hello(0)));
      await new Promise((r) => setTimeout(r, 100));
      const phone = await open('/node');
      phone.ws.send(JSON.stringify({ ...hello(200), kind: 'browser', alias: 'Ada' }));
      await until(() => text.includes('200'));
      expect(text).toBe('0-1\n0-200\n1-2'); // one edge, to the lowest-numbered bird; the other birds are hops away

      // A new topology from the dashboard (a preset, say) does not strand the phone.
      const put = await fetch(`http://127.0.0.1:${hub.port}/api/topology`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '0-1' }) });
      expect(put.status).toBe(200);
      await until(() => text.includes('200'));
      expect(text).toBe('0-1\n0-200');
      await fetch(`http://127.0.0.1:${hub.port}/api/topology`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '0-1\n1-2\n0-200' }) });

      // The room bridge is the phone's own node in the ether, both ways.
      await expect(open('/room?id=5')).rejects.toThrow();
      const room = new WebSocket(`ws://127.0.0.1:${hub.port}/room?id=200`);
      const back: Buffer[] = [];
      room.on('message', (d: Buffer) => back.push(d));
      await new Promise<void>((res, rej) => { room.on('open', () => res()); room.on('error', rej); });
      await until(() => paths.length === 1);
      expect(paths[0]).toMatch(/^\/node\?id=200&x=-1&y=0\.5$/);
      await new Promise((r) => setTimeout(r, 50));
      room.send(new Uint8Array([1, 2, 3, 4]));
      await until(() => back.length === 1);
      expect([...back[0]!]).toEqual([1, 2, 3, 4]);
      room.close();

      phone.ws.close();
      await until(() => !text.includes('200'));
      expect(text).toBe('0-1\n1-2');
      for (const b of birds) b.ws.close();
    } finally {
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => fake.close(() => r()));
    }
  });

  it('refuses noise sources without an ether control URL', async () => {
    await expect(open('/noise')).rejects.toThrow();
  });


  it('transcribes speech through ElevenLabs without exposing the key', async () => {
    const seen: { url: string; key: string | undefined; type: string | undefined; body: string }[] = [];
    let reply: { status: number; body: string } = { status: 200, body: JSON.stringify({ text: '  The eagle lands at noon  ' }) };
    const fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({ url: req.url!, key: req.headers['xi-api-key'] as string | undefined, type: req.headers['content-type'], body: Buffer.concat(chunks).toString('latin1') });
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(reply.body);
      });
    });
    await new Promise<void>((r) => fake.listen(0, r));
    const fakePort = (fake.address() as { port: number }).port;
    try {
      await restart({ elevenLabsKey: 'sk-test', elevenLabsUrl: `http://127.0.0.1:${fakePort}/`, elevenLabsModel: 'scribe_v1' });
      const base = `http://127.0.0.1:${hub.port}`;
      const cfg = await (await fetch(`${base}/config.json`)).json();
      expect(cfg).toMatchObject({ speechToText: true });
      expect(JSON.stringify(cfg)).not.toContain('sk-test');

      const ok = await fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/webm;codecs=opus' }, body: new Uint8Array([1, 2, 3, 4]) });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ text: 'The eagle lands at noon' });
      expect(seen[0]!.url).toBe('/v1/speech-to-text');
      expect(seen[0]!.key).toBe('sk-test');
      expect(seen[0]!.type).toMatch(/^multipart\/form-data/);
      expect(seen[0]!.body).toContain('name="model_id"');
      expect(seen[0]!.body).toContain('scribe_v1');
      expect(seen[0]!.body).toMatch(/name="tag_audio_events"\r\n\r\nfalse/);
      expect(seen[0]!.body).toContain('audio/webm');

      expect((await fetch(`${base}/api/transcribe`, { method: 'POST', body: new Uint8Array(0) })).status).toBe(400);
      expect((await fetch(`${base}/api/transcribe`)).status).toBe(405);

      reply = { status: 200, body: JSON.stringify({ text: '   ' }) };
      expect((await fetch(`${base}/api/transcribe`, { method: 'POST', body: new Uint8Array([1]) })).status).toBe(422);
      reply = { status: 401, body: JSON.stringify({ detail: 'invalid key sk-secret-echo' }) };
      const bad = await fetch(`${base}/api/transcribe`, { method: 'POST', body: new Uint8Array([1]) });
      expect(bad.status).toBe(502);
      const badText = await bad.text();
      expect(badText).toContain('rejected the API key');
      expect(badText).not.toContain('sk-secret-echo');
    } finally {
      await new Promise<void>((r) => fake.close(() => r()));
    }
  });

  it('says speech to text is not set up when there is no key', async () => {
    const base = `http://127.0.0.1:${hub.port}`;
    expect(await (await fetch(`${base}/config.json`)).json()).toMatchObject({ speechToText: false });
    const r = await fetch(`${base}/api/transcribe`, { method: 'POST', body: new Uint8Array([1]) });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toContain('ELEVENLABS_API_KEY');
  });
});
