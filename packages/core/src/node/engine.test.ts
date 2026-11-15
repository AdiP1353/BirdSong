import { describe, expect, it } from 'vitest';
import { MSG_TTL_MS } from '../constants.ts';
import { DEFAULT_NODE_CONFIG } from '../types.ts';
import { buildMesh, decodedBy } from '../../test/helpers.ts';

const line = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

describe('BirdNode engine', () => {
  it('delivers a message between two nodes and never hears itself', async () => {
    const mesh = await buildMesh({ positions: line(2) });
    const msgId = await mesh.nodes[0]!.send('hello flock');
    const ok = await mesh.world.runUntil(() => mesh.nodes[1]!.state().inbox.length > 0, 60_000);
    expect(ok).toBe(true);
    const got = mesh.nodes[1]!.state().inbox[0]!;
    expect(got.msgId).toBe(msgId);
    expect(got.text).toBe('hello flock');
    expect(got.hops).toBe(1);
    expect(got.mine).toBe(false);
    const mine = mesh.nodes[0]!.state().inbox[0]!;
    expect(mine.mine).toBe(true);
    expect(mine.hops).toBe(0);
    // half-duplex: nobody ever records a frame it sang itself
    await mesh.world.run(20_000);
    for (const e of mesh.events) if (e.type === 'heard') expect(e.from).not.toBe(e.node);
  });

  it('ignores a different passphrase', async () => {
    const mesh = await buildMesh({
      positions: line(2),
      perNode: (i) => (i === 1 ? { passphrase: 'other' } : {}),
    });
    const msgId = await mesh.nodes[0]!.send('hello flock');
    await mesh.world.run(30_000);
    expect(decodedBy(mesh, msgId).has(1)).toBe(false);
    expect(mesh.events.some((e) => e.type === 'bad' && e.node === 1 && e.reason === 'netTag')).toBe(true);
    expect(mesh.events.some((e) => e.type === 'sang' && e.node === 1)).toBe(false);
  });

  it('a muted node neither listens nor sings', async () => {
    const mesh = await buildMesh({
      positions: line(2),
      perNode: (i) => (i === 1 ? { config: { env: 'quiet', profile: 'fast', volume: 0.8, muted: true, neighbors: null, camouflage: false, relayLimit: 5 } } : {}),
    });
    await mesh.nodes[0]!.send('hello flock');
    await mesh.world.run(30_000);
    expect(mesh.events.some((e) => e.type === 'heard' && e.node === 1)).toBe(false);
    expect(mesh.events.some((e) => e.type === 'sang' && e.node === 1)).toBe(false);
    expect(mesh.nodes[1]!.state().inbox.length).toBe(0);
  });

  it('filters frames by neighbour list', async () => {
    const mesh = await buildMesh({
      positions: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.25, y: 0.4 }],
      perNode: (i) =>
        i === 2 ? { config: { env: 'quiet', profile: 'fast', volume: 0.8, muted: false, neighbors: [1], camouflage: false, relayLimit: 5 } } : {},
    });
    const msgId = await mesh.nodes[0]!.send('hello flock');
    const ok = await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(2), 120_000);
    expect(ok).toBe(true);
    const first = mesh.events.find((e) => e.type === 'heard' && e.node === 2);
    expect(first && first.type === 'heard' && first.from).toBe(1);
    expect(mesh.events.some((e) => e.type === 'bad' && e.node === 2 && e.reason === 'neighbor')).toBe(true);
  });

  it('burst suppression keeps airtime low in a crowded room', async () => {
    const positions = Array.from({ length: 6 }, (_, i) => ({
      x: 0.4 * Math.cos((2 * Math.PI * i) / 6),
      y: 0.4 * Math.sin((2 * Math.PI * i) / 6),
    }));
    const mesh = await buildMesh({ positions });
    const msgId = await mesh.nodes[0]!.send('x'.repeat(30));
    const k = mesh.nodes[0]!.state().messages[0]!.k;
    const ok = await mesh.world.runUntil(() => decodedBy(mesh, msgId).size === 6, 60_000);
    expect(ok).toBe(true);
    await mesh.world.run(Math.max(0, 60_000 - mesh.world.clock.now()));
    const sang = mesh.events.filter((e) => e.type === 'sang').length;
    console.log(`burst suppression: k=${k}, sang=${sang}, limit=${2 * k + 6}, unsuppressed >= ${6 * k + 1}`);
    expect(sang).toBeLessThanOrEqual(2 * k + 6);
  });

  it('expires messages, keeps the inbox, and stops singing', async () => {
    const mesh = await buildMesh({ positions: line(2) });
    const msgId = await mesh.nodes[0]!.send('hello flock');
    await mesh.world.run(MSG_TTL_MS + 20_000);
    for (const n of [0, 1]) {
      expect(mesh.events.some((e) => e.type === 'expired' && e.node === n && e.msgId === msgId)).toBe(true);
    }
    const before = mesh.events.filter((e) => e.type === 'sang' && e.msgId === msgId).length;
    await mesh.world.run(120_000);
    const after = mesh.events.filter((e) => e.type === 'sang' && e.msgId === msgId).length;
    expect(after).toBe(before);
    expect(mesh.nodes[0]!.state().inbox.length).toBe(1);
    expect(mesh.nodes[1]!.state().inbox.length).toBe(1);
  });

  it('validates message length', async () => {
    const mesh = await buildMesh({ positions: line(1) });
    await expect(mesh.nodes[0]!.send('')).rejects.toBeInstanceOf(RangeError);
    await expect(mesh.nodes[0]!.send('a'.repeat(141))).rejects.toBeInstanceOf(RangeError);
  });

  it('delivers every event to every listener, even if one throws', async () => {
    const mesh = await buildMesh({ positions: line(2) });
    const a: string[] = [];
    const b: string[] = [];
    mesh.nodes[1]!.onEvent((e) => { if (e.type === 'decoded') a.push(e.text); });
    mesh.nodes[1]!.onEvent(() => { throw new Error('boom'); });
    mesh.nodes[1]!.onEvent((e) => { if (e.type === 'decoded') b.push(e.text); });
    const msgId = await mesh.nodes[0]!.send('hello flock');
    expect(await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(1), 60_000)).toBe(true);
    expect(a).toEqual(['hello flock']);
    expect(b).toEqual(['hello flock']);
  });
  it('folds a repeated message into one inbox row with a count', async () => {
    const mesh = await buildMesh({ positions: line(2) });
    const a = await mesh.nodes[0]!.send('hello flock');
    expect(await mesh.world.runUntil(() => decodedBy(mesh, a).has(1), 60_000)).toBe(true);
    const b = await mesh.nodes[0]!.send('hello flock');
    expect(b).not.toBe(a);
    expect(await mesh.world.runUntil(() => decodedBy(mesh, b).has(1), 60_000)).toBe(true);
    const inbox = mesh.nodes[1]!.state().inbox;
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.count).toBeGreaterThanOrEqual(2);
    expect(mesh.nodes[0]!.state().inbox.length).toBe(1);
  });

  it('counts further full copies heard as receptions', async () => {
    const tri = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.25, y: 0.4 }];
    const mesh = await buildMesh({ positions: tri, perNode: () => ({ config: { ...DEFAULT_NODE_CONFIG, relayLimit: 0 } }) });
    const msgId = await mesh.nodes[0]!.send('hello flock');
    expect(await mesh.world.runUntil(() => decodedBy(mesh, msgId).size === 3, 60_000)).toBe(true);
    await mesh.world.run(120_000);
    for (const n of [1, 2]) expect(mesh.nodes[n]!.state().inbox[0]!.count).toBeGreaterThan(1);
    expect(mesh.events.some((e) => e.type === 'relay')).toBe(false);
  });

  it('stops relaying a message received more than relayLimit times, and resumes when the limit rises', async () => {
    const tri = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.25, y: 0.4 }];
    const mesh = await buildMesh({ positions: tri, perNode: () => ({ config: { ...DEFAULT_NODE_CONFIG, relayLimit: 2 } }) });
    const msgId = await mesh.nodes[0]!.send('hello flock');
    expect(await mesh.world.runUntil(() => decodedBy(mesh, msgId).size === 3, 60_000)).toBe(true);
    const stoppedAt = new Map<number, number>();
    await mesh.world.runUntil(() => {
      for (const e of mesh.events) if (e.type === 'relay' && !e.active && !stoppedAt.has(e.node)) stoppedAt.set(e.node, e.t);
      return stoppedAt.size >= 2;
    }, 280_000);
    // Once the others fall silent the last node may never hear enough copies; it trickles on until expiry.
    expect(stoppedAt.size).toBeGreaterThanOrEqual(2);
    for (const e of mesh.events) {
      if (e.type === 'relay' && !e.active) expect(e.count).toBeGreaterThan(2);
    }
    const sangAfter = (n: number) =>
      mesh.events.filter((e) => e.type === 'sang' && e.node === n && e.t > stoppedAt.get(n)! + 5_000).length;
    const end = mesh.world.clock.now();
    await mesh.world.run(Math.max(0, 290_000 - end));
    for (const n of stoppedAt.keys()) {
      expect(sangAfter(n)).toBe(0);
      const st = mesh.nodes[n]!.state();
      expect(st.inbox[0]!.suppressed).toBe(true);
      expect(st.messages[0]!.suppressed).toBe(true);
    }
    const n = [...stoppedAt.keys()][0]!;
    await mesh.nodes[n]!.configure({ relayLimit: 0 });
    expect(mesh.events.some((e) => e.type === 'relay' && e.node === n && e.active)).toBe(true);
    expect(mesh.nodes[n]!.state().messages[0]!.suppressed).toBe(false);
  });
});
