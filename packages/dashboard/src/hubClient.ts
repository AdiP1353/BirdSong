import type { Command, HubToUi, NodeSnapshot, TelemetryEvent } from '@birdsong/core';
import { createHubState } from './server/state.ts';
import type { HubState } from './server/state.ts';

export interface Store {
  state: HubState;
  join: { pwaUrl: string; passphrase: string };
  connected: boolean;
  focus: number | null;
  version: number;
}

type Listener = () => void;

export const store: Store = {
  state: createHubState(),
  join: { pwaUrl: 'http://localhost:3200/app/', passphrase: 'demo-flock' },
  connected: false,
  focus: null,
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
    } else if (msg.type === 'event') {
      store.state.apply(msg.event, msg.event.t);
    } else if (msg.type === 'nodeOffline') {
      store.state.markOffline(msg.node, Date.now());
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
