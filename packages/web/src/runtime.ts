import {
  DEFAULT_NODE_CONFIG, MAX_ALIAS_CHARS, createBirdNode, createModem, createRealClock,
} from '@birdsong/core';
import type { EnvName, NodeConfig, NodeState, ProfileName, TelemetryEvent } from '@birdsong/core';
import { safeGet, safeSet } from './storage.ts';
import { createWebAudioPort } from './webAudioPort.ts';

export interface Runtime {
  kind: 'local' | 'remote';
  start(): Promise<void>;
  state(): Promise<NodeState>;
  send(text: string): Promise<number>;
  configure(patch: Partial<NodeConfig>): Promise<NodeState>;
  onEvent(cb: (e: TelemetryEvent) => void): void;
  audio?: { context: AudioContext; analyser: AnalyserNode };
}

export interface LocalOptions { passphrase: string; env: EnvName; profile: ProfileName; alias: string }

function phoneId(): number {
  const saved = Number(safeGet('birdsong.id'));
  if (Number.isInteger(saved) && saved >= 128 && saved <= 255) return saved;
  const id = 128 + Math.floor(Math.random() * 128);
  safeSet('birdsong.id', String(id));
  return id;
}

export function createLocalRuntime(o: LocalOptions): Runtime & { port: ReturnType<typeof createWebAudioPort> } {
  const port = createWebAudioPort();
  const node = createBirdNode({
    id: phoneId(),
    kind: 'browser',
    passphrase: o.passphrase,
    alias: o.alias.slice(0, MAX_ALIAS_CHARS),
    config: { ...DEFAULT_NODE_CONFIG, env: o.env, profile: o.profile },
    port,
    clock: createRealClock(),
    rng: Math.random,
    modemFactory: createModem,
  });
  return {
    kind: 'local',
    port,
    audio: { context: port.context, analyser: port.analyser },
    async start() {
      void port.start().catch(() => {}); // idempotent; node.start() surfaces the error
      await node.start();
    },
    state: async () => node.state(),
    send: (text) => node.send(text),
    async configure(patch) {
      if (patch.volume !== undefined) port.setVolume(patch.volume);
      await node.configure(patch);
      return node.state();
    },
    onEvent: (cb) => node.onEvent(cb),
  };
}

export interface RemoteRuntime extends Runtime { close(): void }

export function createRemoteRuntime(baseUrl: string = location.origin): RemoteRuntime {
  const base = baseUrl.replace(/\/+$/, '');
  const wsUrl = `${base.replace(/^http/, 'ws')}/api/events`;
  const listeners: Array<(e: TelemetryEvent) => void> = [];
  let ws: WebSocket | null = null;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function connect(): void {
    if (closed) return;
    ws = new WebSocket(wsUrl);
    ws.onmessage = (m) => {
      try {
        const e = JSON.parse(String(m.data)) as TelemetryEvent;
        for (const l of listeners) l(e);
      } catch {
        // ignore malformed
      }
    };
    ws.onclose = () => {
      ws = null;
      if (!closed) timer = setTimeout(connect, 2000);
    };
    ws.onerror = () => ws?.close();
  }

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(base + path, init);
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body as T;
  }
  const post = (body: unknown): RequestInit => ({
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  return {
    kind: 'remote',
    async start() {},
    state: () => json<NodeState>('/api/state'),
    async send(text) {
      return (await json<{ msgId: number }>('/api/send', post({ text }))).msgId;
    },
    configure: (patch) => json<NodeState>('/api/config', post(patch)),
    onEvent(cb) {
      listeners.push(cb);
      if (!ws && !closed && timer === null) connect();
    },
    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      ws?.close();
    },
  };
}
