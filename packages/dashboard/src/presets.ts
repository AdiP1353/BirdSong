/**
 * Ready-made topologies for the simulated 8-node mesh (ids 0..7), in the ether's text format.
 * Plain TypeScript with no imports, so scripts/apply-topology.ts can run it with node directly.
 */
export interface TopologyPreset {
  id: string;
  label: string;
  description: string;
  text: string;
  /** Where the dashboard graph pins each node (viewBox 1200 x 520) while this preset is active. */
  layout: Record<number, [number, number]>;
}

const ringLayout = (): Record<number, [number, number]> => {
  const out: Record<number, [number, number]> = {};
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / 8;
    out[i] = [600 + 330 * Math.cos(a), 250 + 185 * Math.sin(a)];
  }
  return out;
};

export const TOPOLOGY_PRESETS: TopologyPreset[] = [
  {
    id: 'two-flocks',
    label: 'Two flocks',
    description: 'Two groups of four (0-3 and 4-7), joined by three bridges. Node 7 is 3 hops from node 0, and any 2 relays can die.',
    text: [
      '# Two flocks of four, joined by three bridges (1-5, 2-6, 3-4).',
      '0-1,2,3',
      '1-2,3',
      '2-3',
      '4-5,6,7',
      '5-6,7',
      '6-7',
      '1-5',
      '2-6',
      '3-4',
    ].join('\n'),
    layout: {
      0: [170, 250], 1: [400, 90], 2: [480, 250], 3: [400, 410],
      5: [800, 90], 6: [720, 250], 4: [800, 410], 7: [1030, 250],
    },
  },
  {
    id: 'ring',
    label: 'Ring',
    description: 'Each bird hears its two neighbours: 0-1-2-3-4-5-6-7-0. Up to 4 hops; one dead relay is survivable.',
    text: ['0-1', '1-2', '2-3', '3-4', '4-5', '5-6', '6-7', '7-0'].join('\n'),
    layout: ringLayout(),
  },
  {
    id: 'line',
    label: 'Line',
    description: 'A single chain 0-1-2-...-7: 7 hops end to end. Slow, and any dead relay cuts it.',
    text: ['0-1', '1-2', '2-3', '3-4', '4-5', '5-6', '6-7'].join('\n'),
    layout: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, [110 + i * 140, i % 2 === 0 ? 190 : 330]])),
  },
];

export const DEFAULT_PRESET = 'two-flocks';
