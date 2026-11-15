import { useEffect, useRef, useState } from 'preact/hooks';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { NodeSnapshot, TelemetryEvent } from '@birdsong/core';
import { progressFor, relayFor, speciesColor } from '../derive.ts';
import { store } from '../hubClient.ts';
import { closestPreset } from '../presetMatch.ts';

const W = 1200;
const H = 520;
const R = 30;
const LINK_MS = 10_000;
const PULSE_MS = 600;

interface SimNode extends SimulationNodeDatum {
  id: number;
  /** Already placed beside its linked birds once. */
  placed?: boolean;
}
type SimLink = SimulationLinkDatum<SimNode>;

export function FlockGraph(props: { nodes: NodeSnapshot[]; events: TelemetryEvent[]; focus: number | null }) {
  const { nodes, events, focus } = props;
  const [, setTick] = useState(0);
  const sim = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodes = useRef(new Map<number, SimNode>());
  const linkKey = useRef('');

  // Animation clock: re-render every frame so links fade and rings pulse.
  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      setTick((t) => (t + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const s = forceSimulation<SimNode>([])
      .force('charge', forceManyBody().strength(-700))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide(R + 18))
      .force('link', forceLink<SimNode, SimLink>([]).id((d) => d.id).distance(170).strength(0.15));
    sim.current = s;
    return () => {
      s.stop();
    };
  }, []);

  const now = Date.now();

  // Keep simulation nodes in step with snapshot nodes.
  const ids = nodes.map((n) => n.node).join(',');
  const known = [...simNodes.current.keys()].sort((a, b) => a - b).join(',');
  if (sim.current && ids !== known) {
    const next = new Map<number, SimNode>();
    for (const n of nodes) next.set(n.node, simNodes.current.get(n.node) ?? { id: n.node, x: W / 2 + (Math.random() - 0.5) * 200, y: H / 2 + (Math.random() - 0.5) * 200 });
    simNodes.current = next;
    sim.current.nodes([...next.values()]);
    linkKey.current = '';
    sim.current.alpha(0.8).restart();
  }

  // Edges: one per pair that has a recent `heard` event.
  const pulses = new Map<string, { a: number; b: number; last: number }>();
  for (const e of events) {
    if (e.type !== 'heard' || now - e.t > LINK_MS) continue;
    const a = Math.min(e.node, e.from);
    const b = Math.max(e.node, e.from);
    const key = `${a}-${b}`;
    const p = pulses.get(key);
    if (!p) pulses.set(key, { a, b, last: e.t });
    else if (e.t > p.last) p.last = e.t;
  }
  // A manual topology fixes who can hear whom: lay the graph out by its links and draw them faintly.
  const wired = new Map<string, { a: number; b: number }>();
  if (store.topology?.manual) {
    for (const [x, y] of store.topology.links) {
      const a = Math.min(x, y);
      const b = Math.max(x, y);
      wired.set(`${a}-${b}`, { a, b });
    }
  }
  const layoutLinks = wired.size > 0 ? wired : pulses;
  const nextLinkKey = `${wired.size > 0 ? 'w' : 'p'}:${[...layoutLinks.keys()].sort().join('|')}:${[...simNodes.current.keys()].join(',')}`;
  if (sim.current && nextLinkKey !== linkKey.current) {
    linkKey.current = nextLinkKey;
    // A preset topology pins every node to its hand-drawn spot. After birds are added or removed, the closest
    // preset still pins the birds it has, and an extra bird starts beside the birds it is linked to.
    // Distance mode, and manual topologies unlike any preset, are laid out by force.
    const layout = closestPreset(store.topology)?.layout ?? null;
    for (const n of simNodes.current.values()) {
      const at = layout?.[n.id];
      if (at) {
        n.fx = at[0];
        n.fy = at[1];
        continue;
      }
      const wasPinned = n.fx != null;
      n.fx = null;
      n.fy = null;
      if (!layout) continue;
      const near = [...wired.values()]
        .filter((l) => l.a === n.id || l.b === n.id)
        .map((l) => simNodes.current.get(l.a === n.id ? l.b : l.a))
        .filter((m): m is SimNode => m !== undefined && m.x !== undefined);
      if (near.length > 0 && (wasPinned || !n.placed)) {
        n.x = near.reduce((t, m) => t + (m.fx ?? m.x!), 0) / near.length;
        n.y = near.reduce((t, m) => t + (m.fy ?? m.y!), 0) / near.length + 90;
        n.placed = true;
      }
    }
    const links: SimLink[] = [];
    for (const p of layoutLinks.values()) {
      if (simNodes.current.has(p.a) && simNodes.current.has(p.b)) links.push({ source: p.a, target: p.b });
    }
    const lf = sim.current.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>;
    lf.links(links);
    lf.strength(wired.size > 0 ? 0.5 : 0.15).distance(wired.size > 0 ? 210 : 170);
    sim.current.alpha(wired.size > 0 ? 0.8 : 0.3).restart();
  }

  const progress = progressFor(events, focus);
  const relay = relayFor(events, focus);
  const singing = new Set<number>();
  for (const e of events) if (e.type === 'sang' && now - e.t < e.durationMs) singing.add(e.node);

  const pos = (id: number): { x: number; y: number } => {
    const n = simNodes.current.get(id);
    const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
    return { x: clamp(n?.x ?? W / 2, R + 20, W - R - 20), y: clamp(n?.y ?? H / 2, R + 30, H - R - 50) };
  };

  return (
    <svg class="panel graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {[...wired.values()].map((l) => {
        const a = pos(l.a);
        const b = pos(l.b);
        return (
          <line
            key={`w${l.a}-${l.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="var(--fg)" stroke-opacity="0.18" stroke-width="2" stroke-dasharray="6 6"
          />
        );
      })}
      {[...pulses.values()].map((p) => {
        const age = now - p.last;
        const a = pos(p.a);
        const b = pos(p.b);
        const pulse = age < PULSE_MS;
        return (
          <line
            key={`${p.a}-${p.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={pulse ? '#ffffff' : 'var(--accent)'}
            stroke-width={pulse ? 6 : 2}
            opacity={pulse ? 1 : Math.max(0.05, 0.6 * (1 - age / LINK_MS))}
          />
        );
      })}
      {nodes.map((n) => {
        const { x, y } = pos(n.node);
        const off = !n.online || n.config.muted;
        const pr = progress.get(n.node);
        const frac = pr ? (pr.decoded ? 1 : Math.min(1, pr.rank / Math.max(1, pr.k))) : 0;
        const alias = store.state.aliasOf(n.node);
        const label = `#${n.node}${alias ? ` ${alias}` : ''}`;
        const color = off ? '#666' : speciesColor(n.species);
        const circ = 2 * Math.PI * (R + 8);
        return (
          <g key={n.node} transform={`translate(${x},${y})`} opacity={off ? 0.55 : 1}>
            {singing.has(n.node) && !off && [0, 1, 2].map((i) => {
              const phase = ((now / 1200) + i / 3) % 1;
              return <circle r={R + 10 + phase * 50} fill="none" stroke={color} stroke-width="3" opacity={1 - phase} />;
            })}
            <circle r={R + 8} fill="none" stroke="var(--fg)" stroke-opacity="0.2" stroke-width="6" />
            {frac > 0 && (
              <circle
                r={R + 8} fill="none" stroke={frac >= 1 ? '#ffffff' : 'var(--accent)'} stroke-width="6"
                stroke-dasharray={`${circ * frac} ${circ}`} transform="rotate(-90)" stroke-linecap="round"
              />
            )}
            <circle
              r={R} fill={color} stroke="var(--fg)" stroke-width="3"
              stroke-dasharray={n.kind === 'browser' ? '6 5' : undefined}
              fill-opacity={n.kind === 'browser' ? 0.55 : 1}
            />
            <text y={R + 36} text-anchor="middle" font-size="22" fill="var(--fg)" text-decoration={off ? 'line-through' : undefined}>
              {label}
            </text>
            {relay.get(n.node)?.active === false && (
              <text y={-R - 16} text-anchor="middle" font-size="17" fill="#ffb74d">
                quiet · heard {relay.get(n.node)!.count}×
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
