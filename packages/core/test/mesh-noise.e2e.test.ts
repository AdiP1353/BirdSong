/**
 * The mesh with a microphone in the room: room noise (sim/roomNoise.ts) is added to what every bird hears,
 * as the dashboard's "Add noise" panel does through the ether. Messages must still cross the line, about as
 * fast as in silence (carrier sense must not mistake the noise for another bird singing).
 */
import { describe, expect, it } from 'vitest';
import { createModem } from '../src/modem/index.ts';
import { makeRoomNoise } from '../src/sim/roomNoise.ts';
import { mulberry32 } from '../src/util/prng.ts';
import { buildMesh, decodedBy } from './helpers.ts';

const SR = 8000;
/** RMS of a frame as a bird plays it (peak 0.8, default volume 0.8). */
const SIGNAL_RMS = 0.52 * 0.8;

/** Endless room noise at `db` relative to a bird's signal, looping a 30 s take. */
function roomNoise(db: number, seed: number): (n: number) => Float32Array {
  const take = makeRoomNoise(30, SR, mulberry32(seed));
  const g = SIGNAL_RMS * 10 ** (db / 20);
  let at = 0;
  return (n) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = g * take[at]!;
      at = (at + 1) % take.length;
    }
    return out;
  };
}

const line3 = () => buildMesh({
  positions: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  range: 1.2,
  modemFactory: createModem,
  sampleRate: SR,
  env: 'coast',
  profile: 'fast',
  noiseRms: 0.003,
});

/** Virtual seconds until node 2 decodes, or null if not within 60 s. */
async function deliveryTime(db: number | null): Promise<number | null> {
  const mesh = await line3();
  if (db !== null) mesh.world.setAmbient(roomNoise(db, 100 + db));
  const msgId = await mesh.nodes[0]!.send('hello noisy birds');
  const ok = await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(2), 60_000);
  const sang = mesh.events.filter((e) => e.type === 'sang').length;
  const bad = mesh.events.filter((e) => e.type === 'bad').length;
  const t = mesh.world.clock.now() / 1000;
  console.log(`[mesh-noise] ${db === null ? 'silence' : `${db} dB`}: node 2 decoded=${ok} at virtual t=${t.toFixed(1)} s, ${sang} frames sung, ${bad} bad frames`);
  if (!ok) return null;
  expect(mesh.nodes[2]!.state().inbox.find((m) => m.msgId === msgId)!.text).toBe('hello noisy birds');
  return t;
}

describe('mesh end to end with room noise (real modem)', () => {
  let base: number | null = null;
  it('baseline: relays across three nodes in silence', async () => {
    base = await deliveryTime(null);
    expect(base).not.toBeNull();
  }, 300_000);

  // Same seeds as the baseline, so the only difference is the noise. "About as fast" = at most two extra
  // fast frames (3 s each) of delay.
  for (const db of [0, 6]) {
    it(`relays across three nodes with room noise at +${db} dB about as fast as in silence`, async () => {
      const t = await deliveryTime(db);
      expect(t).not.toBeNull();
      expect(t!).toBeLessThanOrEqual(base! + 6);
    }, 300_000);
  }

  it('a message already on its way when the noise starts still arrives intact', async () => {
    const mesh = await line3();
    const msgId = await mesh.nodes[0]!.send('sent before the noise');
    expect(await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(1), 60_000)).toBe(true);
    mesh.world.setAmbient(roomNoise(6, 7));
    const ok = await mesh.world.runUntil(() => decodedBy(mesh, msgId).has(2), 60_000);
    console.log(`[mesh-noise] noise mid-flight: node 2 decoded=${ok} at virtual t=${(mesh.world.clock.now() / 1000).toFixed(1)} s`);
    expect(ok).toBe(true);
    expect(mesh.nodes[2]!.state().inbox.find((m) => m.msgId === msgId)!.text).toBe('sent before the noise');
  }, 300_000);
});
