import { parseTopology } from '@birdsong/core';
import type { TopologyView } from '@birdsong/core';
import { TOPOLOGY_PRESETS } from './presets.ts';
import type { TopologyPreset } from './presets.ts';

const key = (links: readonly (readonly [number, number])[]): string => links.map(([a, b]) => `${a}>${b}`).sort().join('|');
const presetKeys = new Map(TOPOLOGY_PRESETS.map((p) => [p.id, key(parseTopology(p.text)?.links ?? [])]));

/** The preset whose links are exactly the ether's current manual topology, if any. */
export function matchPreset(t: TopologyView | null): TopologyPreset | null {
  if (!t?.manual) return null;
  const k = key(t.links);
  return TOPOLOGY_PRESETS.find((p) => presetKeys.get(p.id) === k) ?? null;
}
