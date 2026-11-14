import { createBirdNode } from '../src/node/index.ts';
import { createFakeModem, createSimWorld } from '../src/sim/index.ts';
import type { Position, SimWorld, Topology } from '../src/sim/index.ts';
import { mulberry32 } from '../src/util/prng.ts';
import { DEFAULT_NODE_CONFIG } from '../src/types.ts';
import type { BirdNode, BirdNodeOptions, ModemFactory } from '../src/types.ts';
import type { TelemetryEvent } from '../src/telemetry.ts';
import type { EnvName, ProfileName } from '../src/envs.ts';

export interface Mesh {
  world: SimWorld;
  nodes: BirdNode[];
  events: TelemetryEvent[];
}

/** positions[i] is node i's position. All nodes share `passphrase` unless overridden. */
export async function buildMesh(opts: {
  positions: Position[];
  range?: number;
  seed?: number;
  passphrase?: string;
  perNode?: (i: number) => Partial<BirdNodeOptions>;
  modemFactory?: ModemFactory;
  sampleRate?: number;
  noiseRms?: number;
  env?: EnvName;
  profile?: ProfileName;
  topology?: Topology | null;
}): Promise<Mesh> {
  const seed = opts.seed ?? 1;
  const world = createSimWorld({
    sampleRate: opts.sampleRate ?? 8000,
    range: opts.range ?? 1.2,
    noiseRms: opts.noiseRms ?? 0,
    seed,
    topology: opts.topology ?? null,
  });
  const events: TelemetryEvent[] = [];
  const nodes: BirdNode[] = [];
  for (let i = 0; i < opts.positions.length; i++) {
    const port = world.addPort(opts.positions[i]!);
    const base: BirdNodeOptions = {
      id: i,
      kind: 'sim',
      passphrase: opts.passphrase ?? 'test-flock',
      config: { ...DEFAULT_NODE_CONFIG, env: opts.env ?? 'quiet', profile: opts.profile ?? 'fast' },
      port,
      clock: world.clock,
      rng: mulberry32(seed * 1000 + i),
      modemFactory: opts.modemFactory ?? createFakeModem,
    };
    const node = createBirdNode({ ...base, ...opts.perNode?.(i) });
    node.onEvent((e) => events.push(e));
    world.onSettle(() => node.settled());
    nodes.push(node);
  }
  await Promise.all(nodes.map((n) => n.start()));
  return { world, nodes, events };
}

/** Node ids with a 'decoded' event for msgId. */
export function decodedBy(mesh: Mesh, msgId: number): Set<number> {
  const out = new Set<number>();
  for (const e of mesh.events) if (e.type === 'decoded' && e.msgId === msgId) out.add(e.node);
  return out;
}
