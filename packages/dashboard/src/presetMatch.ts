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

/**
 * The preset this topology is mostly made of (at least half of their links in common), for laying out the graph
 * after birds were added to or removed from a preset.
 */
export function closestPreset(t: TopologyView | null): TopologyPreset | null {
  if (!t?.manual) return null;
  const mine = new Set(t.links.map(([a, b]) => `${a}>${b}`));
  let best: TopologyPreset | null = null;
  let bestScore = 0.5;
  for (const p of TOPOLOGY_PRESETS) {
    const theirs = (presetKeys.get(p.id) ?? '').split('|').filter(Boolean);
    const shared = theirs.filter((l) => mine.has(l)).length;
    const score = shared / (mine.size + theirs.length - shared);
    if (score >= bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}
