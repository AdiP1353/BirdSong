import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { DEFAULT_NODE_CONFIG } from '@birdsong/core';
import type { Command, HubToUi, TelemetryEvent } from '@birdsong/core';
import { startHub } from '../src/server/hub.ts';

let hub: Awaited<ReturnType<typeof startHub>>;
beforeEach(async () => {
  hub = await startHub({ port: 0, distDir: '/nonexistent-dist' });
});
afterEach(async () => {
  await hub.close();
});

function open(path: string): Promise<{ ws: WebSocket; msgs: string[] }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}${path}`);
    const msgs: string[] = [];
    ws.on('message', (d) => msgs.push(d.toString()));
    ws.on('open', () => res({ ws, msgs }));
    ws.on('error', rej);
  });
}
const until = async (fn: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(fn()).toBe(true);
};
const hello = (node: number): TelemetryEvent => ({
  type: 'hello', node, species: 0, kind: 'sim', config: { ...DEFAULT_NODE_CONFIG }, t: 5,
});

describe('hub', () => {
  it('snapshot lists announced and inferred nodes; stamps t', async () => {
    const n = await open('/node');
    n.ws.send(JSON.stringify(hello(1)));
    n.ws.send(JSON.stringify({ type: 'heard', node: 1, from: 130, msgId: 1, seed: 0, hop: 0, k: 2, sync: 0.5, t: 5 }));
    await new Promise((r) => setTimeout(r, 150));
    const ui = await open('/ui');
    await until(() => ui.msgs.length > 0);
    const snap = JSON.parse(ui.msgs[0]!) as Extract<HubToUi, { type: 'snapshot' }>;
    expect(snap.type).toBe('snapshot');
    expect(snap.nodes.map((x) => [x.node, x.kind])).toEqual([[1, 'sim'], [130, 'browser']]);
    expect(snap.join.passphrase).toBe('demo-flock');
    for (const e of snap.recent) expect(Math.abs(e.t - Date.now())).toBeLessThan(1000);
    n.ws.close();
    ui.ws.close();
  });

  it('forwards live events with a hub timestamp', async () => {
    const ui = await open('/ui');
    const n = await open('/node');
    n.ws.send(JSON.stringify(hello(1)));
    await until(() => ui.msgs.length >= 2);
    const m = JSON.parse(ui.msgs[1]!) as Extract<HubToUi, { type: 'event' }>;
    expect(m.event.t).not.toBe(5);
    expect(Math.abs(m.event.t - Date.now())).toBeLessThan(1000);
    n.ws.close();
    ui.ws.close();
  });

  it('routes commands to one node or all', async () => {
    const a = await open('/node');
    const b = await open('/node');
    const c = await open('/node');
    a.ws.send(JSON.stringify(hello(1)));
    b.ws.send(JSON.stringify(hello(3)));
    c.ws.send(JSON.stringify(hello(4)));
    const ui = await open('/ui');
    await new Promise((r) => setTimeout(r, 150));
    const one: Command = { type: 'configure', node: 3, patch: { muted: true } };
    ui.ws.send(JSON.stringify(one));
    await until(() => b.msgs.length === 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(a.msgs).toHaveLength(0);
    expect(c.msgs).toHaveLength(0);
    expect(JSON.parse(b.msgs[0]!)).toEqual(one);
    ui.ws.send(JSON.stringify({ type: 'configure', node: 'all', patch: { camouflage: true } }));
    await until(() => a.msgs.length === 1 && b.msgs.length === 2 && c.msgs.length === 1);
    for (const x of [a, b, c, ui]) x.ws.close();
  });

  it('sends nodeOffline when a node closes', async () => {
    const ui = await open('/ui');
    const n = await open('/node');
    n.ws.send(JSON.stringify(hello(9)));
    await until(() => ui.msgs.length >= 2);
    n.ws.close();
    await until(() => ui.msgs.some((m) => (JSON.parse(m) as HubToUi).type === 'nodeOffline'));
    expect(JSON.parse(ui.msgs.at(-1)!)).toEqual({ type: 'nodeOffline', node: 9 });
    ui.ws.close();
  });

  it('serves a notice when dist is missing and config.json', async () => {
    const r = await fetch(`http://127.0.0.1:${hub.port}/`);
    expect(await r.text()).toContain('not built');
    const c = await (await fetch(`http://127.0.0.1:${hub.port}/config.json`)).json();
    expect(c).toEqual({ etherUrl: null });
  });
});
