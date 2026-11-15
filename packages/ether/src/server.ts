import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import {
  LINK_GAIN, formatTopology, gainBetween, hasLinks, hears, mixBlock, mulberry32, parseTopology,
} from '@birdsong/core';
import type { Topology } from '@birdsong/core';

export interface EtherOptions {
  port?: number;
  range?: number;
  noiseRms?: number;
  sampleRate?: number;
  /** Manual links (node ids); null/absent = hear by distance. */
  topology?: Topology | null;
  /** Bearer token for PUT /topology. null/absent = live edits disabled. */
  controlToken?: string | null;
}

interface NodeConn { ws: WebSocket; x: number; y: number; queue: Float32Array[]; queued: number }
interface Listener { ws: WebSocket; x: number; y: number; noise: boolean }
/** Background sound in the room (the dashboard's "Add noise"), heard by every node at gain 1. */
interface NoiseSource { ws: WebSocket; queue: Float32Array[]; queued: number }

const BLOCK_MS = 20;
/** A noise source may run at most this far ahead of real time; older samples are dropped. */
const NOISE_MAX_QUEUE_MS = 200;

export function startEtherServer(opts: EtherOptions = {}): Promise<{ close(): Promise<void>; port: number }> {
  const range = opts.range ?? 1.2;
  const noiseRms = opts.noiseRms ?? 0.002;
  const sampleRate = opts.sampleRate ?? 48000;
  const B = Math.round(BLOCK_MS * sampleRate / 1000);
  const controlToken = opts.controlToken || null;
  let topology: Topology | null = opts.topology ?? null;
  const server = createServer((req, res) => { void route(req, res); });
  const wss = new WebSocketServer({ server });
  const nodes = new Map<number, NodeConn>();
  const listeners = new Set<Listener>();
  const noiseSources = new Set<NoiseSource>();
  const noiseMax = Math.round(NOISE_MAX_QUEUE_MS * sampleRate / 1000);
  const rng = mulberry32(1);

  const view = () => ({
    manual: topology !== null,
    text: formatTopology(topology),
    links: topology ? topology.links.map(([a, b]) => [a, b]) : [],
  });
  function reply(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 16384) { reject(new Error('body too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/noise' && req.method === 'GET') { reply(res, 200, { sources: noiseSources.size }); return; }
    if (path !== '/topology') { reply(res, 404, { error: 'not found' }); return; }
    if (req.method === 'GET') { reply(res, 200, view()); return; }
    if (req.method !== 'PUT') { reply(res, 405, { error: 'use GET or PUT' }); return; }
    if (!controlToken) { reply(res, 403, { error: 'live topology edits are disabled (no ETHER_CONTROL_TOKEN)' }); return; }
    if (req.headers.authorization !== `Bearer ${controlToken}`) { reply(res, 401, { error: 'bad or missing control token' }); return; }
    let text: unknown;
    try {
      text = (JSON.parse(await readBody(req)) as { text?: unknown } | null)?.text;
    } catch (err) {
      reply(res, 400, { error: (err as Error).message });
      return;
    }
    if (typeof text !== 'string') { reply(res, 400, { error: 'body must be {"text": "<links>"}' }); return; }
    try {
      topology = parseTopology(text);
    } catch (err) {
      reply(res, 400, { error: (err as Error).message });
      return;
    }
    console.log(topology ? `topology set: ${formatTopology(topology).replace(/\n/g, ' ')}` : 'topology cleared: distance mode');
    reply(res, 200, view());
  }

  function readF32(data: unknown): Float32Array {
    const buf = Array.isArray(data) ? Buffer.concat(data as Buffer[]) : Buffer.from(data as Buffer);
    const n = buf.length >> 2;
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = buf.readFloatLE(i * 4);
    return f;
  }

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
      if (topology && !hasLinks(topology, id)) console.warn(`node ${id} has no links in the manual topology; it will hear nothing`);
      ws.on('message', (data, isBinary) => {
        if (!isBinary) return;
        const f = readF32(data);
        conn.queue.push(f);
        conn.queued += f.length;
      });
      ws.on('close', () => {
        if (nodes.get(id) === conn) {
          nodes.delete(id);
          console.log(`node ${id} disconnected`);
        }
      });
      ws.on('error', () => {});
    } else if (url.pathname === '/noise') {
      // Only the hub holds the control token; the public proxy does not forward /noise.
      if (!controlToken || req.headers.authorization !== `Bearer ${controlToken}`) { ws.close(1008, 'bad or missing control token'); return; }
      const src: NoiseSource = { ws, queue: [], queued: 0 };
      noiseSources.add(src);
      console.log(`noise source connected (${noiseSources.size} in the room)`);
      ws.on('message', (data, isBinary) => {
        if (!isBinary) return;
        const f = readF32(data);
        for (let i = 0; i < f.length; i++) {
          const v = f[i]!;
          f[i] = Number.isFinite(v) ? Math.max(-4, Math.min(4, v)) : 0;
        }
        src.queue.push(f);
        src.queued += f.length;
        // Keep the newest NOISE_MAX_QUEUE_MS: a source that runs fast (or bursts after a stall) never lags.
        while (src.queued > noiseMax && src.queue.length > 0) {
          const over = src.queued - noiseMax;
          const head = src.queue[0]!;
          if (head.length <= over) { src.queue.shift(); src.queued -= head.length; }
          else { src.queue[0] = head.subarray(over); src.queued -= over; }
        }
      });
      ws.on('close', () => {
        noiseSources.delete(src);
        console.log(`noise source disconnected (${noiseSources.size} left)`);
      });
      ws.on('error', () => {});
    } else if (url.pathname === '/listen') {
      const l: Listener = { ws, x, y, noise: url.searchParams.get('noise') !== '0' };
      listeners.add(l);
      console.log(`listener connected at (${x},${y})`);
      ws.on('close', () => { listeners.delete(l); console.log('listener disconnected'); });
      ws.on('error', () => {});
    } else {
      ws.close(1008, 'bad path');
    }
  });

  function take(c: { queue: Float32Array[]; queued: number }): Float32Array {
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
    const ids = [...nodes.keys()];
    const list = [...nodes.values()];
    const tx = list.map(take);
    let noise: Float32Array | null = null;
    for (const src of noiseSources) {
      const f = take(src);
      if (!noise) noise = f;
      else for (let k = 0; k < B; k++) noise[k]! += f[k]!;
    }
    if (list.length > 0) {
      const topo = topology;
      const gains = list.map((a, j) => list.map((b, i) => {
        if (i === j) return 0;
        if (topo) return hears(topo, ids[j]!, ids[i]!) ? LINK_GAIN : 0;
        return gainBetween(a, b, range);
      }));
      const rx = mixBlock(tx, gains, noiseRms, rng);
      for (let i = 0; i < list.length; i++) {
        const r = rx[i]!;
        if (noise) for (let k = 0; k < B; k++) r[k]! += noise[k]!;
        sendF32(list[i]!.ws, r);
      }
    }
    for (const l of listeners) {
      const out = new Float32Array(B);
      for (let j = 0; j < list.length; j++) {
        const g = gainBetween(list[j]!, l, Infinity);
        const s = tx[j]!;
        for (let k = 0; k < B; k++) out[k]! += g * s[k]!;
      }
      if (noise && l.noise) for (let k = 0; k < B; k++) out[k]! += noise[k]!;
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
    server.once('error', reject);
    server.listen(opts.port ?? 7080, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 7080);
      console.log(`ether listening on ${port}`);
      console.log(topology ? `topology: ${formatTopology(topology).replace(/\n/g, ' ')}` : 'topology: distance mode');
      resolve({
        port,
        close: () => new Promise<void>((res) => {
          clearInterval(timer);
          for (const c of wss.clients) c.terminate();
          wss.close();
          server.closeAllConnections();
          server.close(() => res());
        }),
      });
    });
  });
}

/** Startup topology from ETHER_TOPOLOGY (inline text) or ETHER_TOPOLOGY_FILE (path; a missing file = distance mode). */
export function topologyFromEnv(env: Record<string, string | undefined>): Topology | null {
  const inline = env['ETHER_TOPOLOGY'];
  const file = env['ETHER_TOPOLOGY_FILE'];
  if (inline && file) throw new Error('set ETHER_TOPOLOGY or ETHER_TOPOLOGY_FILE, not both');
  if (inline) return parseTopology(inline);
  if (file) {
    if (!existsSync(file)) return null;
    try {
      return parseTopology(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`${file}: ${(err as Error).message}`);
    }
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let topology: Topology | null;
  try {
    topology = topologyFromEnv(process.env);
  } catch (err) {
    console.error(`ether: bad topology: ${(err as Error).message}`);
    process.exit(2);
  }
  await startEtherServer({
    port: Number(process.env.ETHER_PORT ?? 7080),
    range: Number(process.env.ETHER_RANGE ?? 1.2),
    noiseRms: Number(process.env.ETHER_NOISE_RMS ?? 0.002),
    sampleRate: Number(process.env.ETHER_SAMPLE_RATE ?? 48000),
    topology,
    controlToken: process.env.ETHER_CONTROL_TOKEN || null,
  });
}
