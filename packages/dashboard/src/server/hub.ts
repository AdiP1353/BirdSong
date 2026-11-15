import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { HUB_PORT, formatTopology, parseTopology } from '@birdsong/core';
import type { Command, HubToUi, TelemetryEvent, TopologyView } from '@birdsong/core';
import { createHubState } from './state.ts';
import { createInteractionLog } from './interactionLog.ts';

export interface HubOptions {
  port?: number;
  passphrase?: string;
  pwaUrl?: string;
  etherUrl?: string | null;
  distDir?: string;
  /** Built phone/node web app served at /app/ (default packages/web/dist). */
  webDistDir?: string;
  /** NDJSON interaction log file; null/absent = memory only. */
  logFile?: string | null;
  /** Public base URL of the node reverse proxy (e.g. http://localhost:3100), sent to the dashboard in /config.json. */
  proxyUrl?: string | null;
  /** Internal base URL of the ether's control API (e.g. http://ether:7080). null/absent = topology panel hidden. */
  etherControlUrl?: string | null;
  /** Bearer token the ether expects on PUT /topology. */
  etherControlToken?: string | null;
  /** Internal base URL of the nursery (adds/removes bird containers). null/absent = add/remove hidden. */
  nurseryUrl?: string | null;
  /** Bearer token the nursery expects. */
  nurseryToken?: string | null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const here = dirname(fileURLToPath(import.meta.url));

export function startHub(opts: HubOptions = {}): Promise<{ port: number; close(): Promise<void> }> {
  const passphrase = opts.passphrase ?? 'demo-flock';
  let pwaUrl = opts.pwaUrl ?? '';
  const proxyUrl = opts.proxyUrl ?? null;
  const etherUrl = opts.etherUrl ?? null;
  const etherControlUrl = opts.etherControlUrl ? opts.etherControlUrl.replace(/\/+$/, '') : null;
  const etherControlToken = opts.etherControlToken ?? null;
  const nurseryUrl = opts.nurseryUrl ? opts.nurseryUrl.replace(/\/+$/, '') : null;
  const nurseryToken = opts.nurseryToken ?? null;
  const distDir = resolve(opts.distDir ?? join(here, '..', '..', 'dist'));
  const webDistDir = resolve(opts.webDistDir ?? join(here, '..', '..', '..', 'web', 'dist'));
  const log = createInteractionLog({ file: opts.logFile ?? null });
  const state = createHubState();
  const nodeSockets = new Map<number, WebSocket>();
  const socketNode = new Map<WebSocket, number>();
  const uiSockets = new Set<WebSocket>();
  /** Upstream sockets to the ether's /noise, one per dashboard noise source. */
  const noiseUpstreams = new Set<WebSocket>();
  let noiseSources = 0;
  /**
   * Disabled = the demo's "turn the dashboard off": the hub drops every node connection and refuses new
   * ones, so it neither sees nor controls the flock. Messages still travel bird to bird through the air.
   */
  let disabled = false;
  /**
   * "Stop birds": every bird is muted (it neither sings nor listens), and a bird that connects while this is on
   * is muted as soon as it says hello. Start unmutes every bird.
   */
  let stopped = false;
  const muteAll = (muted: boolean): string => JSON.stringify({ type: 'configure', node: 'all', patch: { muted } } satisfies Command);

  const sendUi = (msg: HubToUi): void => {
    const s = JSON.stringify(msg);
    for (const ws of uiSockets) if (ws.readyState === WebSocket.OPEN) ws.send(s);
  };

  async function serveFrom(root: string, pathname: string, res: ServerResponse, notBuilt: string): Promise<void> {
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    if (rel.includes('..') || rel.includes('\0')) {
      res.writeHead(400).end('bad request');
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(400).end('bad request');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      try {
        await readFile(join(root, 'index.html'));
        res.writeHead(404).end('not found');
      } catch {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(notBuilt);
      }
    }
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((ok, fail) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 16384) { fail(new Error('body too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
      req.on('error', fail);
    });
  }

  /** GET or PUT the ether's topology. A successful PUT is logged and sent to every dashboard. */
  async function etherTopology(text?: string): Promise<{ status: number; body: unknown }> {
    if (!etherControlUrl) return { status: 503, body: { error: 'the hub has no ether control URL (set ETHER_CONTROL_URL)' } };
    const put = text !== undefined;
    let r: Response;
    try {
      r = await fetch(`${etherControlUrl}/topology`, {
        method: put ? 'PUT' : 'GET',
        body: put ? JSON.stringify({ text }) : undefined,
        headers: put
          ? { 'content-type': 'application/json', ...(etherControlToken ? { authorization: `Bearer ${etherControlToken}` } : {}) }
          : {},
        signal: AbortSignal.timeout(3000),
      });
    } catch (err) {
      return { status: 503, body: { error: `cannot reach the ether: ${(err as Error).message}` } };
    }
    const raw = await r.text();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = { error: raw }; }
    if (put && r.ok) {
      const topology = parsed as TopologyView;
      log.append('topology', { manual: topology.manual, text: topology.text });
      sendUi({ type: 'topology', topology });
    }
    return { status: r.status, body: parsed };
  }

  async function nursery(method: string, path: string, body?: unknown): Promise<{ status: number; body: { error?: string } & Record<string, unknown> }> {
    if (!nurseryUrl) return { status: 503, body: { error: 'the hub has no nursery (set NURSERY_URL)' } };
    try {
      const r = await fetch(`${nurseryUrl}${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { 'content-type': 'application/json', ...(nurseryToken ? { authorization: `Bearer ${nurseryToken}` } : {}) },
        signal: AbortSignal.timeout(30_000),
      });
      const raw = await r.text();
      let parsed: { error?: string } & Record<string, unknown>;
      try { parsed = JSON.parse(raw) as typeof parsed; } catch { parsed = { error: raw }; }
      return { status: r.status, body: parsed };
    } catch (err) {
      return { status: 503, body: { error: `cannot reach the nursery: ${(err as Error).message}` } };
    }
  }

  /**
   * POST /api/birds {id?, links?} adds a bird: the nursery starts its container, and in manual topology mode the
   * hub links it two-way to `links`. DELETE /api/birds/<id> removes one and drops its links.
   */
  async function birdsRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (disabled) { reply(409, { error: 'the dashboard is off' }); return; }
    const del = /^\/api\/birds\/(\d{1,3})$/.exec(path);
    if (del && req.method === 'DELETE') {
      const id = Number(del[1]);
      const n = await nursery('DELETE', `/birds/${id}`);
      if (n.status !== 200) { reply(n.status, n.body); return; }
      const topo = await etherTopology();
      const view = topo.body as TopologyView;
      if (topo.status === 200 && view.manual) {
        const links = view.links.filter(([a, b]) => a !== id && b !== id);
        // Keep the old text rather than fall back to distance mode when the last link goes.
        if (links.length > 0 && links.length !== view.links.length) await etherTopology(formatTopology({ links }));
      }
      state.remove(id);
      const ws = nodeSockets.get(id);
      if (ws) { nodeSockets.delete(id); socketNode.delete(ws); ws.close(); }
      log.append('flock', { removed: id });
      sendUi({ type: 'nodeRemoved', node: id });
      reply(200, { id, removed: true });
      return;
    }
    if (path !== '/api/birds' || req.method !== 'POST') { reply(405, { error: 'use POST /api/birds or DELETE /api/birds/<id>' }); return; }
    let body: { id?: unknown; links?: unknown };
    try {
      body = (JSON.parse((await readBody(req)) || '{}') ?? {}) as typeof body;
    } catch (err) {
      reply(400, { error: (err as Error).message });
      return;
    }
    const known = new Set(state.snapshot().map((n) => n.node));
    let id: number;
    if (body.id === undefined || body.id === null || body.id === '') {
      id = 0;
      while (id < 128 && known.has(id)) id++;
      if (id === 128) { reply(409, { error: 'no free bird id (0..127)' }); return; }
    } else {
      id = Number(body.id);
      if (!Number.isInteger(id) || id < 0 || id > 127) { reply(400, { error: 'id must be an integer 0..127' }); return; }
      const cur = state.snapshot().find((n) => n.node === id);
      if (cur?.online) { reply(409, { error: `bird ${id} is already in the flock` }); return; }
    }
    const links = Array.isArray(body.links) ? body.links.map(Number) : [];
    if (links.some((l) => !Number.isInteger(l) || l < 0 || l > 255 || l === id)) {
      reply(400, { error: 'links must be other bird ids' });
      return;
    }
    const topo = await etherTopology();
    if (topo.status !== 200) { reply(topo.status, topo.body); return; }
    const view = topo.body as TopologyView;
    if (view.manual && links.length === 0) { reply(400, { error: 'pick at least one bird it can hear (the topology is manual)' }); return; }
    const like = state.snapshot().find((n) => n.online && n.kind === 'container');
    const n = await nursery('POST', '/birds', {
      id, x: id % 4, y: Math.floor(id / 4),
      ...(like ? { env: like.config.env, profile: like.config.profile, relayLimit: like.config.relayLimit } : {}),
    });
    if (n.status !== 201) { reply(n.status, n.body); return; }
    state.restore(id);
    if (view.manual) {
      const text = `${formatTopology(parseTopology(view.text))}\n${id}-${[...new Set(links)].join(',')}`;
      const put = await etherTopology(text);
      if (put.status !== 200) { reply(put.status, put.body); return; }
    }
    log.append('flock', { added: id, links });
    reply(201, { id, links: view.manual ? links : [] });
  }

  /** The hub is the only client that changes the ether's topology; it relays to the ether's control API. */
  async function topologyRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET' && req.method !== 'PUT') { reply(405, { error: 'use GET or PUT' }); return; }
    if (req.method === 'GET') {
      const r = await etherTopology();
      reply(r.status, r.body);
      return;
    }
    let text: unknown;
    try {
      text = (JSON.parse(await readBody(req)) as { text?: unknown } | null)?.text;
    } catch (err) {
      reply(400, { error: (err as Error).message });
      return;
    }
    if (typeof text !== 'string') { reply(400, { error: 'body must be {"text": "<links>"}' }); return; }
    const r = await etherTopology(text);
    reply(r.status, r.body);
  }

  function setDisabled(next: boolean): void {
    if (next === disabled) return;
    disabled = next;
    log.append('disabled', { disabled });
    if (disabled) {
      for (const ws of [...socketNode.keys()]) ws.close(1013, 'dashboard disabled');
    }
    sendUi({ type: 'disabled', disabled });
  }

  async function stoppedRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET') { reply(200, { stopped }); return; }
    if (req.method !== 'POST') { reply(405, { error: 'use GET or POST' }); return; }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      reply(400, { error: (err as Error).message });
      return;
    }
    const v = (body as { stopped?: unknown } | null)?.stopped;
    if (typeof v !== 'boolean') { reply(400, { error: 'body must be {"stopped": true|false}' }); return; }
    if (disabled) { reply(409, { error: 'the dashboard is off, so it cannot reach the birds' }); return; }
    if (v !== stopped) {
      stopped = v;
      log.append('stopped', { stopped });
      const text = muteAll(stopped);
      for (const s of nodeSockets.values()) if (s.readyState === WebSocket.OPEN) s.send(text);
      sendUi({ type: 'stopped', stopped });
    }
    reply(200, { stopped });
  }

  async function disabledRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET') { reply(200, { disabled }); return; }
    if (req.method !== 'POST') { reply(405, { error: 'use GET or POST' }); return; }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      reply(400, { error: (err as Error).message });
      return;
    }
    const v = (body as { disabled?: unknown } | null)?.disabled;
    if (typeof v !== 'boolean') { reply(400, { error: 'body must be {"disabled": true|false}' }); return; }
    setDisabled(v);
    reply(200, { disabled });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    if (p === '/api/disabled') {
      await disabledRoute(req, res);
      return;
    }
    if (p === '/api/stopped') {
      await stoppedRoute(req, res);
      return;
    }
    if (p === '/config.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        etherUrl, proxyUrl, topologyEditable: etherControlUrl !== null, flockEditable: nurseryUrl !== null,
        noiseEditable: etherControlUrl !== null,
      }));
      return;
    }
    if (p === '/api/birds' || p.startsWith('/api/birds/')) {
      await birdsRoute(req, res, p);
      return;
    }
    if (p === '/api/topology') {
      await topologyRoute(req, res);
      return;
    }
    if (p === '/api/log') {
      const after = Number(url.searchParams.get('since') ?? 0) || 0;
      const limit = Math.min(2000, Math.max(1, Math.floor(Number(url.searchParams.get('limit') ?? 500) || 500)));
      const entries = log.since(after, limit);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ entries, next: entries.length > 0 ? entries[entries.length - 1]!.seq : after }));
      return;
    }
    if (p === '/app') {
      res.writeHead(301, { location: '/app/' }).end();
      return;
    }
    if (p.startsWith('/app/')) {
      await serveFrom(webDistDir, p.slice('/app'.length), res, 'The phone app is not built. Run: npm run build -w @birdsong/web\n');
      return;
    }
    await serveFrom(distDir, p, res, 'BirdSong hub is running, but the dashboard UI is not built. Run: npm run build -w @birdsong/dashboard\n');
  }

  const server: Server = createServer((req, res) => {
    void route(req, res);
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path !== '/node' && path !== '/ui' && path !== '/noise') {
      socket.destroy();
      return;
    }
    if (path === '/noise' && !etherControlUrl) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    if (path === '/node' && disabled) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (path === '/node') onNode(ws);
      else if (path === '/noise') onNoise(ws);
      else onUi(ws);
    });
  });

  function onNode(ws: WebSocket): void {
    ws.on('message', (data) => {
      let event: TelemetryEvent;
      try {
        event = JSON.parse(data.toString()) as TelemetryEvent;
      } catch {
        return;
      }
      if (typeof event !== 'object' || event === null || typeof event.node !== 'number' || typeof event.type !== 'string') return;
      const now = Date.now();
      event.t = now;
      if (event.type === 'hello') {
        const old = nodeSockets.get(event.node);
        if (old && old !== ws) {
          socketNode.delete(old);
          old.close();
        }
        nodeSockets.set(event.node, ws);
        socketNode.set(ws, event.node);
        if (stopped && !event.config?.muted) ws.send(muteAll(true));
      }
      state.apply(event, now);
      log.append('event', event);
      sendUi({ type: 'event', event });
    });
    ws.on('close', () => {
      const id = socketNode.get(ws);
      socketNode.delete(ws);
      if (id === undefined) return;
      if (nodeSockets.get(id) === ws) nodeSockets.delete(id);
      state.markOffline(id, Date.now());
      log.append('offline', { node: id });
      sendUi({ type: 'nodeOffline', node: id });
    });
    ws.on('error', () => {});
  }

  /**
   * A dashboard tab that feeds noise (its microphone, or test noise) into the room. Binary messages are
   * Float32 PCM at the ether's rate and go straight to the ether's /noise with the control token, which only
   * the hub holds. A text message {source, level} says what is playing, for the log.
   */
  function onNoise(ws: WebSocket): void {
    const up = new WebSocket(`${etherControlUrl!.replace(/^http/, 'ws')}/noise`, {
      headers: etherControlToken ? { authorization: `Bearer ${etherControlToken}` } : {},
    });
    noiseUpstreams.add(up);
    noiseSources++;
    log.append('noise', { sources: noiseSources });
    sendUi({ type: 'noise', sources: noiseSources });
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      noiseUpstreams.delete(up);
      noiseSources--;
      log.append('noise', { sources: noiseSources });
      sendUi({ type: 'noise', sources: noiseSources });
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      if (up.readyState === WebSocket.OPEN) up.close();
      else if (up.readyState === WebSocket.CONNECTING) up.terminate();
    };
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Real-time sound: if the ether link is not up yet, drop it rather than queue it.
        if (up.readyState === WebSocket.OPEN) up.send(data, { binary: true });
        return;
      }
      let m: { source?: unknown; level?: unknown };
      try { m = JSON.parse(data.toString()) as typeof m; } catch { return; }
      if (typeof m !== 'object' || m === null) return;
      if (typeof m.source !== 'string' || m.source.length > 16 || typeof m.level !== 'number' || !Number.isFinite(m.level)) return;
      log.append('noise', { source: m.source, level: m.level });
    });
    ws.on('close', close);
    ws.on('error', () => {});
    up.on('close', close);
    up.on('error', () => {});
  }

  function onUi(ws: WebSocket): void {
    uiSockets.add(ws);
    const snap: HubToUi = {
      type: 'snapshot', nodes: state.snapshot(), recent: state.recent(),
      join: { pwaUrl, passphrase }, disabled, noiseSources, stopped,
    };
    ws.send(JSON.stringify(snap));
    ws.on('message', (data) => {
      let cmd: Command;
      try {
        cmd = JSON.parse(data.toString()) as Command;
      } catch {
        return;
      }
      if (typeof cmd !== 'object' || cmd === null) return;
      if (disabled) return;
      log.append('command', cmd);
      const text = JSON.stringify(cmd);
      if (cmd.node === 'all') {
        for (const s of nodeSockets.values()) if (s.readyState === WebSocket.OPEN) s.send(text);
      } else {
        const s = nodeSockets.get(cmd.node);
        if (s && s.readyState === WebSocket.OPEN) s.send(text);
      }
    });
    ws.on('close', () => uiSockets.delete(ws));
    ws.on('error', () => {});
  }

  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? HUB_PORT, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      if (pwaUrl === '') pwaUrl = `http://localhost:${port}/app/`;
      resolveStart({
        port,
        close() {
          return new Promise<void>((done) => {
            for (const ws of wss.clients) ws.terminate();
            for (const ws of noiseUpstreams) ws.terminate();
            log.close();
            wss.close();
            server.closeAllConnections();
            server.close(() => done());
          });
        },
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.HUB_PORT ?? HUB_PORT);
  const hub = await startHub({
    port,
    passphrase: process.env.CHANNEL_PASSPHRASE ?? 'demo-flock',
    pwaUrl: process.env.PWA_URL || undefined,
    etherUrl: process.env.ETHER_URL || null,
    proxyUrl: process.env.PROXY_URL || null,
    logFile: process.env.HUB_LOG_FILE || null,
    webDistDir: process.env.WEB_DIST || undefined,
    etherControlUrl: process.env.ETHER_CONTROL_URL || null,
    etherControlToken: process.env.ETHER_CONTROL_TOKEN || null,
    nurseryUrl: process.env.NURSERY_URL || null,
    nurseryToken: process.env.NURSERY_TOKEN || null,
  });
  console.log(`hub listening on ${hub.port}${process.env.HUB_LOG_FILE ? `, logging to ${process.env.HUB_LOG_FILE}` : ''}`);
}
