import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { WebSocketServer } from 'ws';
import type { BirdNode } from '@birdsong/core';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.wav': 'audio/wav',
};

export interface HttpHandle {
  server: Server;
  port: number;
  close(): Promise<void>;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 4096) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text === '' ? {} : JSON.parse(text)); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

export function startHttp(node: BirdNode, port: number, distDir?: string): Promise<HttpHandle> {
  const dist = distDir ?? fileURLToPath(new URL('../../web/dist/', import.meta.url));
  const wss = new WebSocketServer({ noServer: true });

  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (!existsSync(dist)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p>BirdSong web UI is not built (run: npm run build -w @birdsong/web).</p>');
      return;
    }
    let rel: string;
    try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end(); return; }
    if (rel.includes('..') || rel.includes('\0')) { res.writeHead(404); res.end('not found'); return; }
    let file = join(dist, rel);
    if (!file.startsWith(dist.replace(/\/$/, '')) ) { res.writeHead(404); res.end('not found'); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (extname(rel) !== '' && !rel.endsWith('/')) { res.writeHead(404); res.end('not found'); return; }
      file = join(dist, 'index.html');
      if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    if (p.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }
      if (p === '/api/state' && req.method === 'GET') { json(res, 200, node.state()); return; }
      if (p === '/api/send' && req.method === 'POST') {
        readJson(req).then(async (body) => {
          const text = (body as { text?: unknown } | null)?.text;
          if (typeof text !== 'string') { json(res, 400, { error: 'text must be a string' }); return; }
          try {
            json(res, 200, { msgId: await node.send(text) });
          } catch (err) {
            json(res, 400, { error: (err as Error).message });
          }
        }).catch((err: Error) => json(res, 400, { error: err.message }));
        return;
      }
      if (p === '/api/config' && req.method === 'POST') {
        readJson(req).then(async (body) => {
          if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            json(res, 400, { error: 'body must be a JSON object' });
            return;
          }
          try {
            await node.configure(body as Record<string, unknown>);
            json(res, 200, node.state());
          } catch (err) {
            json(res, 400, { error: (err as Error).message });
          }
        }).catch((err: Error) => json(res, 400, { error: err.message }));
        return;
      }
      json(res, 404, { error: 'not found' });
      return;
    }
    if (p === '/' && url.search === '') {
      res.writeHead(302, { Location: '/?runtime=remote' });
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    serveStatic(req, res, p);
  });

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/api/events') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  node.onEvent((e) => {
    const msg = JSON.stringify(e);
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        server,
        port: actual,
        close: () => new Promise<void>((r) => {
          for (const c of wss.clients) c.terminate();
          wss.close();
          server.close(() => r());
          server.closeAllConnections();
        }),
      });
    });
  });
}
