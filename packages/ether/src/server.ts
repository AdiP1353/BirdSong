import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { mixBlock, gainBetween, mulberry32 } from '@birdsong/core';

export interface EtherOptions {
  port?: number;
  range?: number;
  noiseRms?: number;
  sampleRate?: number;
}

interface NodeConn { ws: WebSocket; x: number; y: number; queue: Float32Array[]; queued: number }
interface Listener { ws: WebSocket; x: number; y: number }

const BLOCK_MS = 20;

export function startEtherServer(opts: EtherOptions = {}): Promise<{ close(): Promise<void>; port: number }> {
  const range = opts.range ?? 1.2;
  const noiseRms = opts.noiseRms ?? 0.002;
  const sampleRate = opts.sampleRate ?? 48000;
  const B = Math.round(BLOCK_MS * sampleRate / 1000);
  const wss = new WebSocketServer({ port: opts.port ?? 7080 });
  const nodes = new Map<number, NodeConn>();
  const listeners = new Set<Listener>();
  const rng = mulberry32(1);

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const x = Number(url.searchParams.get('x') ?? 0) || 0;
    const y = Number(url.searchParams.get('y') ?? 0) || 0;
    if (url.pathname === '/node') {
      const id = Number(url.searchParams.get('id'));
      if (!Number.isInteger(id) || id < 0 || id > 255) { ws.close(1008, 'bad id'); return; }
      const old = nodes.get(id);
      if (old) { nodes.delete(id); old.ws.close(); }
      const conn: NodeConn = { ws, x, y, queue: [], queued: 0 };
      nodes.set(id, conn);
      console.log(`node ${id} connected at (${x},${y})`);
      ws.on('message', (data, isBinary) => {
        if (!isBinary) return;
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
        const n = buf.length >> 2;
        const f = new Float32Array(n);
        for (let i = 0; i < n; i++) f[i] = buf.readFloatLE(i * 4);
        conn.queue.push(f);
        conn.queued += n;
      });
      ws.on('close', () => {
        if (nodes.get(id) === conn) {
          nodes.delete(id);
          console.log(`node ${id} disconnected`);
        }
      });
      ws.on('error', () => {});
    } else if (url.pathname === '/listen') {
      const l: Listener = { ws, x, y };
      listeners.add(l);
      console.log(`listener connected at (${x},${y})`);
      ws.on('close', () => { listeners.delete(l); console.log('listener disconnected'); });
      ws.on('error', () => {});
    } else {
      ws.close(1008, 'bad path');
    }
  });

  function take(c: NodeConn): Float32Array {
    const out = new Float32Array(B);
    let filled = 0;
    while (filled < B && c.queue.length > 0) {
      const head = c.queue[0]!;
      const n = Math.min(B - filled, head.length);
      out.set(head.subarray(0, n), filled);
      filled += n;
      c.queued -= n;
      if (n === head.length) c.queue.shift();
      else c.queue[0] = head.subarray(n);
    }
    return out;
  }

  function sendF32(ws: WebSocket, f: Float32Array) {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
  }

  function processBlock() {
    const list = [...nodes.values()];
    const tx = list.map(take);
    if (list.length > 0) {
      const gains = list.map((a, j) => list.map((b, i) => (i === j ? 0 : gainBetween(a, b, range))));
      const rx = mixBlock(tx, gains, noiseRms, rng);
      for (let i = 0; i < list.length; i++) sendF32(list[i]!.ws, rx[i]!);
    }
    for (const l of listeners) {
      const out = new Float32Array(B);
      for (let j = 0; j < list.length; j++) {
        const g = gainBetween(list[j]!, l, Infinity);
        const s = tx[j]!;
        for (let k = 0; k < B; k++) out[k]! += g * s[k]!;
      }
      sendF32(l.ws, out);
    }
  }

  let nextDue = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    let n = 0;
    while (nextDue <= now && n < 10) {
      processBlock();
      nextDue += BLOCK_MS;
      n++;
    }
    if (n === 10 && nextDue <= now) nextDue = now;
  }, 10);

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const addr = wss.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 7080);
      console.log(`ether listening on ${port}`);
      resolve({
        port,
        close: () => new Promise<void>((res) => {
          clearInterval(timer);
          for (const c of wss.clients) c.terminate();
          wss.close(() => res());
        }),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startEtherServer({
    port: Number(process.env.ETHER_PORT ?? 7080),
    range: Number(process.env.ETHER_RANGE ?? 1.2),
    noiseRms: Number(process.env.ETHER_NOISE_RMS ?? 0.002),
    sampleRate: Number(process.env.ETHER_SAMPLE_RATE ?? 48000),
  });
}
