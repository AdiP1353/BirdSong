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
  /**
   * ElevenLabs API key for speech-to-text on the phone app (its 🎤 button). The key lives only in the hub: phones post
   * audio to POST /api/transcribe and never see it. null/absent = the microphone button is hidden.
   */
  elevenLabsKey?: string | null;
  /** ElevenLabs speech-to-text model (default scribe_v1). */
  elevenLabsModel?: string | null;
  /** ElevenLabs API base URL (default https://api.elevenlabs.io); tests point it at a fake. */
  elevenLabsUrl?: string | null;
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
  const elevenLabsKey = opts.elevenLabsKey || null;
  const elevenLabsModel = opts.elevenLabsModel || 'scribe_v1';
  const elevenLabsUrl = (opts.elevenLabsUrl || 'https://api.elevenlabs.io').replace(/\/+$/, '');
  const SPEECH_MAX_BYTES = 8 * 1024 * 1024;
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

  function readBytes(req: IncomingMessage, max: number): Promise<Buffer> {
    return new Promise((ok, fail) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > max) { fail(new Error('body too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => ok(Buffer.concat(chunks)));
      req.on('error', fail);
    });
  }
  const readBody = async (req: IncomingMessage): Promise<string> => (await readBytes(req, 16384)).toString('utf8');

  /**
   * Speech to text for the message box. POST /api/transcribe with the recorded audio as the body (any audio type the
   * phone's recorder makes) returns {text}. The hub adds the ElevenLabs key; this is the only part of the demo that
   * needs the internet, and it happens before a message is sent. Nothing is logged: the audio and text are the
   * person's, and the message is logged anyway when they send it.
   */
  async function transcribeRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') { reply(405, { error: 'use POST' }); return; }
    if (!elevenLabsKey) { reply(503, { error: 'speech to text is not set up (the hub has no ELEVENLABS_API_KEY)' }); return; }
    let audio: Buffer;
    try {
      audio = await readBytes(req, SPEECH_MAX_BYTES);
    } catch (err) {
      reply(413, { error: (err as Error).message });
      return;
    }
    if (audio.length === 0) { reply(400, { error: 'no audio received' }); return; }
    const type = (req.headers['content-type'] ?? 'audio/webm').split(';')[0]!.trim() || 'audio/webm';
    const form = new FormData();
    form.append('model_id', elevenLabsModel);
    // No "[birds chirping]" tags: the phone dictates next to the flock's speakers, and only the words belong in a message.
    form.append('tag_audio_events', 'false');
    form.append('file', new Blob([new Uint8Array(audio)], { type }), 'speech');
    let r: Response;
    try {
      r = await fetch(`${elevenLabsUrl}/v1/speech-to-text`, {
        method: 'POST', body: form, headers: { 'xi-api-key': elevenLabsKey }, signal: AbortSignal.timeout(30_000),
      });
    } catch {
      reply(503, { error: 'cannot reach ElevenLabs (speech to text needs the internet)' });
      return;
    }
    if (!r.ok) {
      // 401 means a wrong key. Say so without echoing anything ElevenLabs sent back.
      reply(502, { error: r.status === 401 ? 'ElevenLabs rejected the API key' : `ElevenLabs returned HTTP ${r.status}` });
      return;
    }
    const body = await r.json().catch(() => null) as { text?: unknown } | null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (text === '') { reply(422, { error: 'no speech heard. Try again, closer to the microphone' }); return; }
    reply(200, { text });
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
    if (p === '/api/transcribe') {
      await transcribeRoute(req, res);
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
        noiseEditable: etherControlUrl !== null, speechToText: elevenLabsKey !== null,
      }));
      return;
    }
    if (p === '/api/birds' || p.startsWith('/api/birds/')) {
      await birdsRoute(req, res, p);
      return;
    }
    if (p === '/api/topology') {
      await topologyRoute(req, res);
      // A preset or a typed topology knows nothing of the phones: give each connected phone an edge again.
      if (req.method === 'PUT') {
        for (const n of state.snapshot()) if (n.kind === 'browser' && nodeSockets.has(n.node)) await linkPhone(n.node);
      }
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
    if (path !== '/node' && path !== '/ui' && path !== '/noise' && path !== '/room') {
      socket.destroy();
      return;
    }
    const roomId = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('id'));
    if (path === '/room' && !(Number.isInteger(roomId) && roomId >= 128 && roomId <= 255)) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    if ((path === '/noise' || path === '/room') && !etherControlUrl) {
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
      else if (path === '/room') onRoom(ws, roomId);
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
        if (event.kind === 'browser') void linkPhone(event.node);
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
      if (state.snapshot().find((n) => n.node === id)?.kind === 'browser') void unlinkPhone(id);
      state.markOffline(id, Date.now());
      log.append('offline', { node: id });
      sendUi({ type: 'nodeOffline', node: id });
    });
    ws.on('error', () => {});
  }

  /**
   * A phone is a node like any other: it talks only along its edges. When one says hello and the topology is
   * manual, give it one two-way link, to the lowest-numbered bird that is online, unless it has links already
   * (the dashboard can then redraw them, like any bird's). In distance mode the room has a spot instead (onRoom).
   */
  async function linkPhone(id: number): Promise<void> {
    const topo = await etherTopology();
    const view = topo.body as TopologyView;
    if (topo.status !== 200 || !view.manual || view.links.some(([a, b]) => a === id || b === id)) return;
    const bird = state.snapshot().filter((n) => n.online && n.kind !== 'browser').map((n) => n.node).sort((a, b) => a - b)[0];
    if (bird === undefined) return;
    await etherTopology(`${view.text}\n${id}-${bird}`);
  }

  /** The phone left: drop its links (never the last link, which would switch the ether to distance mode). */
  async function unlinkPhone(id: number): Promise<void> {
    const topo = await etherTopology();
    const view = topo.body as TopologyView;
    if (topo.status !== 200 || !view.manual) return;
    const links = view.links.filter(([a, b]) => a !== id && b !== id);
    if (links.length > 0 && links.length !== view.links.length) await etherTopology(formatTopology({ links }));
  }

  /** Where the room (the dashboard computer, with the phones around it) stands in distance mode: beside birds 0 and 4. */
  const ROOM_AT = { x: -1, y: 0.5 };

  /**
   * The room bridge ("Hear phones"): a dashboard tab stands in the simulated air as the phone, node `id`. What its
   * microphone hears goes into the ether as that node's song, and the ether sends back what that node hears (only
   * the birds it is linked to), which the tab plays through the speakers for the phone. So the phone reaches, and
   * is reached by, its neighbours only; the rest of the flock gets its message hop by hop.
   */
  function onRoom(ws: WebSocket, id: number): void {
    const up = new WebSocket(`${etherControlUrl!.replace(/^http/, 'ws')}/node?id=${id}&x=${ROOM_AT.x}&y=${ROOM_AT.y}`);
    noiseUpstreams.add(up);
    log.append('room', { node: id, on: true });
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      noiseUpstreams.delete(up);
      log.append('room', { node: id, on: false });
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      if (up.readyState === WebSocket.OPEN) up.close();
      else if (up.readyState === WebSocket.CONNECTING) up.terminate();
    };
    ws.on('message', (data, isBinary) => {
      if (isBinary && up.readyState === WebSocket.OPEN) up.send(data, { binary: true });
    });
    up.on('message', (data, isBinary) => {
      if (isBinary && ws.readyState === WebSocket.OPEN) ws.send(data, { binary: true });
    });
    ws.on('close', close);
    ws.on('error', () => {});
    up.on('close', close);
    up.on('error', () => {});
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
    elevenLabsKey: process.env.ELEVENLABS_API_KEY || null,
    elevenLabsModel: process.env.ELEVENLABS_STT_MODEL || null,
  });
  console.log(`hub listening on ${hub.port}${process.env.HUB_LOG_FILE ? `, logging to ${process.env.HUB_LOG_FILE}` : ''}`);
}
