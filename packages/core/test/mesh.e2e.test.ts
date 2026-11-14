import { describe, expect, it } from 'vitest';
import { buildMesh, decodedBy } from './helpers.ts';
import type { Mesh } from './helpers.ts';
import { parseTopology } from '../src/sim/topology.ts';

const line = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

async function kill(mesh: Mesh, i: number): Promise<void> {
  await mesh.nodes[i]!.configure({ muted: true });
  mesh.world.setAlive(i, false);
}

function report(name: string, mesh: Mesh): void {
  const sang = mesh.events.filter((e) => e.type === 'sang').length;
  console.log(`[mesh] ${name}: finished at virtual t=${(mesh.world.clock.now() / 1000).toFixed(1)} s, ${sang} frames sung`);
}

describe('mesh end to end (fake modem)', () => {
  it('1. line, multi-hop: node 4 decodes at 4 hops', async () => {
    const mesh = await buildMesh({ positions: line(5), range: 1.2 });
    const msgId = await mesh.nodes[0]!.send('hi');
    const ok = await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(4), 180_000);
    report('line multi-hop', mesh);
    expect(ok).toBe(true);
    const got = mesh.nodes[4]!.state().inbox.find((m) => m.msgId === msgId)!;
    expect(got.hops).toBe(4);
  });

  it('2. kill two relays mid-flight: every survivor still decodes', async () => {
    const positions = Array.from({ length: 8 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) }));
    const mesh = await buildMesh({ positions, range: 1.5 });
    const msgId = await mesh.nodes[0]!.send('x'.repeat(40));
    await mesh.world.run(4000);
    await kill(mesh, 1);
    await kill(mesh, 6);
    const survivors = [2, 3, 4, 5, 7];
    const ok = await mesh.world.runUntil(() => survivors.every((n) => decodedBy(mesh, msgId).has(n)), 240_000);
    report('kill two relays', mesh);
    if (!ok) {
      console.log('decoded by', [...decodedBy(mesh, msgId)]);
      console.log(mesh.events.slice(-20));
    }
    expect(ok).toBe(true);
  });

  it('3. originator dies after its burst: the message still crosses the line', async () => {
    const mesh = await buildMesh({ positions: line(5), range: 1.2 });
    const msgId = await mesh.nodes[0]!.send('hi');
    expect(await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(1), 120_000)).toBe(true);
    await kill(mesh, 0);
    const ok = await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(4), 240_000);
    report('originator dies', mesh);
    expect(ok).toBe(true);
  });

  it('4. two writers at once: everyone gets both messages', async () => {
    const positions = [{ x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0, y: 0.4 }, { x: 0.4, y: 0.4 }];
    const mesh = await buildMesh({ positions });
    const [a, b] = await Promise.all([mesh.nodes[0]!.send('hello from zero'), mesh.nodes[3]!.send('hello from three')]);
    const ok = await mesh.world.runUntil(
      () => mesh.nodes.every((n) => n.state().inbox.some((m) => m.msgId === a) && n.state().inbox.some((m) => m.msgId === b)),
      240_000,
    );
    report('two writers', mesh);
    expect(a).not.toBe(b);
    expect(ok).toBe(true);
  });

  it('5. late joiner: a node that unmutes later still gets the message', async () => {
    const mesh = await buildMesh({
      positions: line(3),
      perNode: (i) => (i === 2 ? { config: { env: 'quiet', profile: 'fast', volume: 0.8, muted: true, neighbors: null, camouflage: false } } : {}),
    });
    const msgId = await mesh.nodes[0]!.send('hi');
    expect(await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(1), 120_000)).toBe(true);
    await mesh.world.run(30_000);
    await mesh.nodes[2]!.configure({ muted: false });
    const ok = await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(2), 240_000);
    report('late joiner', mesh);
    expect(ok).toBe(true);
  });

  it('6. manual topology: nodes in range but unlinked relay through the hub node', async () => {
    const positions = [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0, y: 0.3 }];
    const mesh = await buildMesh({ positions, topology: parseTopology('0-1,2') });
    const msgId = await mesh.nodes[1]!.send('via zero');
    const ok = await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(2), 180_000);
    report('manual topology', mesh);
    expect(ok).toBe(true);
    expect(mesh.nodes[2]!.state().inbox.find((m) => m.msgId === msgId)!.hops).toBe(2);
    const heardBy2 = mesh.events.filter((e) => e.type === 'heard' && e.node === 2 && e.msgId === msgId);
    expect(heardBy2.length).toBeGreaterThan(0);
    expect(heardBy2.every((e) => e.type === 'heard' && e.from === 0)).toBe(true);
  });
});
