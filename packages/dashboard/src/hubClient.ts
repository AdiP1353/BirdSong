import type { Command, HubToUi, NodeSnapshot, TelemetryEvent, TopologyView } from '@birdsong/core';
import { createHubState } from './server/state.ts';
import type { HubState } from './server/state.ts';

export interface Store {
  state: HubState;
  join: { pwaUrl: string; passphrase: string };
  connected: boolean;
  focus: number | null;
  /** The ether's topology; null until the Topology panel loads it. */
  topology: TopologyView | null;
  /** The hub has cut itself off from the flock (the "disable dashboard" demo). */
  disabled: boolean;
  /** Noise sources feeding the air right now (from any dashboard tab). */
  noiseSources: number;
  /** "Stop birds" is on: the hub keeps every bird muted. */
  stopped: boolean;
  version: number;
}

type Listener = () => void;

export const store: Store = {
  state: createHubState(),
  join: { pwaUrl: 'http://localhost:3200/app/', passphrase: 'demo-flock' },
  connected: false,
  focus: null,
  topology: null,
  disabled: false,
  noiseSources: 0,
  stopped: false,
  version: 0,
};

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(): void {
  store.version++;
  for (const fn of listeners) fn();
}

export function setFocus(msgId: number | null): void {
  store.focus = msgId;
  changed();
}

export function setTopology(t: TopologyView): void {
  store.topology = t;
  changed();
}

/** Stop every bird (the hub mutes them all, and any bird that joins) or start them all again. */
export async function setStopped(stopped: boolean): Promise<void> {
  const r = await fetch('/api/stopped', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stopped }),
  });
  if (r.ok) {
    store.stopped = ((await r.json()) as { stopped: boolean }).stopped;
    changed();
  }
}

/** Turn the dashboard off (the hub drops every node) or back on. */
export async function setDisabled(disabled: boolean): Promise<void> {
  const r = await fetch('/api/disabled', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ disabled }),
  });
  if (r.ok) {
    store.disabled = ((await r.json()) as { disabled: boolean }).disabled;
    changed();
  }
}

async function birdsCall(method: string, path: string, body?: unknown): Promise<void> {
  const r = await fetch(path, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const b = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `HTTP ${r.status}`);
  }
}

/** Add a bird (a new container); in manual topology mode it is linked two-way to `links`. */
export function addBird(id: number | null, links: number[]): Promise<void> {
  return birdsCall('POST', '/api/birds', { id, links });
}

/** Remove a bird: its container stops and its links leave the topology. */
export async function removeBird(id: number): Promise<void> {
  await birdsCall('DELETE', `/api/birds/${id}`);
  store.state.remove(id);
  changed();
}

export function sendCommand(cmd: Command): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
}

export function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ui`);
  socket = ws;
  ws.onopen = () => {
    store.connected = true;
    changed();
  };
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data)) as HubToUi;
    if (msg.type === 'snapshot') {
      store.state.load(msg.nodes as NodeSnapshot[], msg.recent as TelemetryEvent[]);
      store.join = msg.join;
      store.disabled = msg.disabled ?? false;
      store.noiseSources = msg.noiseSources ?? 0;
      store.stopped = msg.stopped ?? false;
    } else if (msg.type === 'event') {
      store.state.apply(msg.event, msg.event.t);
    } else if (msg.type === 'nodeOffline') {
      store.state.markOffline(msg.node, Date.now());
    } else if (msg.type === 'topology') {
      store.topology = msg.topology;
    } else if (msg.type === 'disabled') {
      store.disabled = msg.disabled;
    } else if (msg.type === 'nodeRemoved') {
      store.state.remove(msg.node);
    } else if (msg.type === 'noise') {
      store.noiseSources = msg.sources;
    } else if (msg.type === 'stopped') {
      store.stopped = msg.stopped;
    }
    changed();
  };
  ws.onclose = () => {
    store.connected = false;
    changed();
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
}
