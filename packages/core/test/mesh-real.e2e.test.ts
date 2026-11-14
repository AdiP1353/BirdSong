import { describe, expect, it } from 'vitest';
import { createModem } from '../src/modem/index.ts';
import { buildMesh, decodedBy } from './helpers.ts';

describe('mesh end to end (real modem)', () => {
  it('relays a message across three nodes in a line through the real modem', async () => {
    const mesh = await buildMesh({
      positions: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      range: 1.2,
      modemFactory: createModem,
      sampleRate: 8000,
      env: 'coast',
      profile: 'fast',
      noiseRms: 0.003,
    });
    const msgId = await mesh.nodes[0]!.send('hello real birds!!');
    const ok = await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(2), 150_000);
    const sang = mesh.events.filter((e) => e.type === 'sang').length;
    const bad = mesh.events.filter((e) => e.type === 'bad').length;
    console.log(`[mesh-real] node 2 decoded=${ok} at virtual t=${(mesh.world.clock.now() / 1000).toFixed(1)} s, ${sang} frames sung, ${bad} bad frames`);
    expect(ok).toBe(true);
  }, 300_000);
});
