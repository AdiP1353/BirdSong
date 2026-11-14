import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { HUB_PORT } from '@birdsong/core';
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
  const distDir = resolve(opts.distDir ?? join(here, '..', '..', 'dist'));
  const webDistDir = resolve(opts.webDistDir ?? join(here, '..', '..', '..', 'web', 'dist'));
  const log = createInteractionLog({ file: opts.logFile ?? null });
  const state = createHubState();
  const nodeSockets = new Map<number, WebSocket>();
  const socketNode = new Map<WebSocket, number>();
  const uiSockets = new Set<WebSocket>();

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

  /** The hub is the only client that changes the ether's topology; it relays to the ether's control API. */
  async function topologyRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!etherControlUrl) { reply(503, { error: 'the hub has no ether control URL (set ETHER_CONTROL_URL)' }); return; }
    if (req.method !== 'GET' && req.method !== 'PUT') { reply(405, { error: 'use GET or PUT' }); return; }
    let body: string | undefined;
    if (req.method === 'PUT') {
      try {
        body = await readBody(req);
      } catch (err) {
        reply(400, { error: (err as Error).message });
        return;
      }
    }
    let r: Response;
    try {
      r = await fetch(`${etherControlUrl}/topology`, {
        method: req.method,
        body,
        headers: req.method === 'PUT'
          ? { 'content-type': 'application/json', ...(etherControlToken ? { authorization: `Bearer ${etherControlToken}` } : {}) }
          : {},
        signal: AbortSignal.timeout(3000),
      });
    } catch (err) {
      reply(503, { error: `cannot reach the ether: ${(err as Error).message}` });
      return;
    }
    const text = await r.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
    if (req.method === 'PUT' && r.ok) {
      const topology = parsed as TopologyView;
      log.append('topology', { manual: topology.manual, text: topology.text });
      sendUi({ type: 'topology', topology });
    }
    reply(r.status, parsed);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    if (p === '/config.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ etherUrl, proxyUrl, topologyEditable: etherControlUrl !== null }));
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
    if (path !== '/node' && path !== '/ui') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (path === '/node') onNode(ws);
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

  function onUi(ws: WebSocket): void {
    uiSockets.add(ws);
    const snap: HubToUi = {
      type: 'snapshot', nodes: state.snapshot(), recent: state.recent(),
      join: { pwaUrl, passphrase },
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
  });
  console.log(`hub listening on ${hub.port}${process.env.HUB_LOG_FILE ? `, logging to ${process.env.HUB_LOG_FILE}` : ''}`);
}
