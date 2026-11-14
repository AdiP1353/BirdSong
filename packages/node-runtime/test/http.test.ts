import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startHttp } from '../src/http.ts';
import type { HttpHandle } from '../src/http.ts';
import { makeFakeNode } from './fakeNode.ts';

let h: HttpHandle | null = null;
afterEach(async () => { await h?.close(); h = null; });

async function setup() {
  const node = makeFakeNode();
  const dist = mkdtempSync(join(tmpdir(), 'bs-dist-'));
  writeFileSync(join(dist, 'index.html'), '<p>index</p>');
  writeFileSync(join(dist, 'app.js'), 'x');
  h = await startHttp(node, 0, dist + '/');
  return { node, base: `http://127.0.0.1:${h.port}` };
}

describe('node http api', () => {
  it('GET /api/state', async () => {
    const { base } = await setup();
    const r = await fetch(`${base}/api/state`);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect((await r.json()).id).toBe(3);
  });
  it('POST /api/send parses JSON whatever the content type', async () => {
    const { base, node } = await setup();
    const r = await fetch(`${base}/api/send`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: '{"text":"hi"}' });
    expect(await r.json()).toEqual({ msgId: 42 });
    expect(node.calls).toContain('send:hi');
  });
  it('send errors and invalid JSON give 400', async () => {
    const { base } = await setup();
    const long = await fetch(`${base}/api/send`, { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(200) }) });
    expect(long.status).toBe(400);
    expect((await long.json()).error).toMatch(/too long/);
    const bad = await fetch(`${base}/api/send`, { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
  });
  it('POST /api/config returns state', async () => {
    const { base, node } = await setup();
    const r = await fetch(`${base}/api/config`, { method: 'POST', body: JSON.stringify({ volume: 0.3 }) });
    expect((await r.json()).config.volume).toBe(0.3);
    expect(node.calls.some((c) => c.startsWith('configure:'))).toBe(true);
  });
  it('serves static files, redirects / and blocks traversal', async () => {
    const { base } = await setup();
    const root = await fetch(`${base}/`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('?runtime=remote');
    const idx = await fetch(`${base}/?runtime=remote`);
    expect(await idx.text()).toBe('<p>index</p>');
    expect((await fetch(`${base}/app.js`)).headers.get('content-type')).toMatch(/javascript/);
    expect(await (await fetch(`${base}/some/route`)).text()).toBe('<p>index</p>');
    expect((await fetch(`${base}/..%2f..%2fetc/passwd`)).status).toBe(404);
    expect((await fetch(`${base}/missing.png`)).status).toBe(404);
  });
  it('streams events over /api/events', async () => {
    const { base, node } = await setup();
    const ws = new WebSocket(base.replace('http', 'ws') + '/api/events');
    const got = new Promise<string>((resolve) => ws.on('message', (d) => resolve(d.toString())));
    await new Promise<void>((r) => ws.on('open', () => r()));
    node.emit({ type: 'expired', node: 3, msgId: 1, t: 0 });
    expect(JSON.parse(await got)).toMatchObject({ type: 'expired', msgId: 1 });
    ws.close();
  });
});
