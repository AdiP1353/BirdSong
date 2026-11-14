import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { connectObservatory } from '../src/telemetry.ts';
import type { Observatory } from '../src/telemetry.ts';
import { makeFakeNode } from './fakeNode.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await sleep(20);
  }
}

let obs: Observatory | null = null;
let wss: WebSocketServer | null = null;
afterEach(async () => {
  obs?.close();
  obs = null;
  if (wss) { for (const c of wss.clients) c.terminate(); await new Promise((r) => wss!.close(r)); }
  wss = null;
});

function listen(port: number): Promise<WebSocketServer> {
  return new Promise((resolve) => {
    const s: WebSocketServer = new WebSocketServer({ port }, () => resolve(s));
  });
}

describe('connectObservatory', () => {
  it('connects on /node, sends hello first, obeys commands, reconnects', async () => {
    wss = await listen(0);
    const port = (wss.address() as { port: number }).port;
    const urls: string[] = [];
    const msgs: any[] = [];
    const wire = (s: WebSocketServer) => s.on('connection', (ws, req) => {
      urls.push(req.url ?? '');
      ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    });
    wire(wss);
    const node = makeFakeNode(3);
    obs = connectObservatory(`ws://127.0.0.1:${port}/`, node);
    await until(() => msgs.length >= 1);
    expect(urls[0]).toBe('/node');
    expect(msgs[0]).toMatchObject({ type: 'hello', node: 3 });

    node.emit({ type: 'expired', node: 3, msgId: 9, t: 1 });
    await until(() => msgs.some((m) => m.type === 'expired'));

    const client = [...wss.clients][0]!;
    client.send(JSON.stringify({ type: 'configure', node: 3, patch: { volume: 0.1 } }));
    client.send(JSON.stringify({ type: 'configure', node: 4, patch: { volume: 0.9 } }));
    client.send(JSON.stringify({ type: 'send', node: 'all', text: 'x' }));
    client.send(JSON.stringify({ type: 'configure', node: 'all', patch: { muted: true } }));
    await until(() => node.calls.length >= 2);
    await sleep(100);
    expect(node.calls.filter((c) => c.includes('0.9'))).toHaveLength(0);
    expect(node.calls).toContain('configure:{"volume":0.1}');
    expect(node.calls).toContain('configure:{"muted":true}');

    // restart on the same port
    for (const c of wss.clients) c.terminate();
    await new Promise((r) => wss!.close(r));
    msgs.length = 0;
    wss = await listen(port);
    wire(wss);
    await until(() => msgs.length >= 1, 10000);
    expect(msgs[0]).toMatchObject({ type: 'hello', node: 3 });
  }, 20000);
});
