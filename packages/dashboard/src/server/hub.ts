import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { HUB_PORT } from '@birdsong/core';
import type { Command, HubToUi, TelemetryEvent } from '@birdsong/core';
import { createHubState } from './state.ts';

export interface HubOptions {
  port?: number;
  passphrase?: string;
  pwaUrl?: string;
  etherUrl?: string | null;
  distDir?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json', '.woff2': 'font/woff2',
};

const here = dirname(fileURLToPath(import.meta.url));

export function startHub(opts: HubOptions = {}): Promise<{ port: number; close(): Promise<void> }> {
  const passphrase = opts.passphrase ?? 'demo-flock';
  const pwaUrl = opts.pwaUrl ?? 'http://localhost:5180/';
  const etherUrl = opts.etherUrl ?? null;
  const distDir = resolve(opts.distDir ?? join(here, '..', '..', 'dist'));
  const state = createHubState();
  const nodeSockets = new Map<number, WebSocket>();
  const socketNode = new Map<WebSocket, number>();
  const uiSockets = new Set<WebSocket>();

  const sendUi = (msg: HubToUi): void => {
    const s = JSON.stringify(msg);
    for (const ws of uiSockets) if (ws.readyState === WebSocket.OPEN) ws.send(s);
  };

  async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/config.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ etherUrl }));
      return;
    }
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    if (rel.includes('..') || rel.includes('\0')) {
      res.writeHead(400).end('bad request');
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(distDir, rel));
    if (file !== distDir && !file.startsWith(distDir + sep)) {
      res.writeHead(400).end('bad request');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      try {
        await readFile(join(distDir, 'index.html'));
        res.writeHead(404).end('not found');
      } catch {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('BirdSong hub is running, but the dashboard UI is not built. Run: npm run build -w @birdsong/dashboard\n');
      }
    }
  }

  const server: Server = createServer((req, res) => {
    void serveStatic(req, res);
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
      sendUi({ type: 'event', event });
    });
    ws.on('close', () => {
      const id = socketNode.get(ws);
      socketNode.delete(ws);
      if (id === undefined) return;
      if (nodeSockets.get(id) === ws) nodeSockets.delete(id);
      state.markOffline(id, Date.now());
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
      resolveStart({
        port,
        close() {
          return new Promise<void>((done) => {
            for (const ws of wss.clients) ws.terminate();
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
    pwaUrl: process.env.PWA_URL ?? 'http://localhost:5180/',
    etherUrl: process.env.ETHER_URL || null,
  });
  console.log(`hub listening on ${hub.port}`);
}
