import { useEffect, useRef, useState } from 'preact/hooks';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import type { NodeSnapshot, TelemetryEvent } from '@birdsong/core';
import { messageColor, progressFor, relayFor, singingNow, speciesColor, toggleLinkText, trailFor } from '../derive.ts';
import { sendCommand, setTopology, store } from '../hubClient.ts';
import type { TopologyView } from '@birdsong/core';
import { closestPreset } from '../presetMatch.ts';

const W = 1200;
const H = 520;
const R = 30;
const LINK_MS = 10_000;
const PULSE_MS = 600;
/** Pointer travel (in graph units) before a press on a bird counts as drawing a link, not a tap. */
const DRAG_MIN = 14;
const SHOT_MS = 700;

interface Drag { from: number; x: number; y: number; moved: boolean }

/** Phones sit in the graph's corners, clear of every preset's birds; a fifth phone onwards is placed by force. */
const PHONE_SPOTS: [number, number][] = [[W - 90, 75], [90, 75], [W - 90, H - 100], [90, H - 100]];

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
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const shots = useRef(new Map<number, number>());
  const [note, setNote] = useState<string | null>(null);

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
  const phoneKey = nodes.filter((n) => n.kind === 'browser').map((n) => n.node).join(',');
  const nextLinkKey = `${wired.size > 0 ? 'w' : 'p'}:${[...layoutLinks.keys()].sort().join('|')}:${[...simNodes.current.keys()].join(',')}:${phoneKey}`;
  if (sim.current && nextLinkKey !== linkKey.current) {
    linkKey.current = nextLinkKey;
    // A preset topology pins every node to its hand-drawn spot. After birds are added or removed, the closest
    // preset still pins the birds it has, and an extra bird starts beside the birds it is linked to.
    // Distance mode, and manual topologies unlike any preset, are laid out by force.
    const layout = closestPreset(store.topology)?.layout ?? null;
    const phoneIds = nodes.filter((n) => n.kind === 'browser').map((n) => n.node).sort((a, b) => a - b);
    for (const n of simNodes.current.values()) {
      const spot = PHONE_SPOTS[phoneIds.indexOf(n.id)];
      if (spot) {
        n.fx = spot[0];
        n.fy = spot[1];
        continue;
      }
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
  const songs = singingNow(events, now);
  const singing = new Set<number>(songs.map((s) => s.node));
  // Birds from before the `singing` event existed only report when a frame ends.
  for (const e of events) if (e.type === 'sang' && now - e.t < 400) singing.add(e.node);
  const trail = trailFor(events, focus);
  // "Stop birds" mutes the whole flock; that is a pause, not a massacre, so no crosses then.
  const flock = nodes.filter((n) => n.online && n.kind !== 'browser');
  const everyoneMuted = store.stopped || (flock.length > 1 && flock.every((n) => n.config.muted));
  const byId = new Map(nodes.map((n) => [n.node, n]));
  const alive = (id: number): boolean => { const n = byId.get(id); return !!n && n.online && !n.config.muted; };
  const phones = nodes.filter((n) => n.kind === 'browser').map((n) => n.node);
  /**
   * Who hears a bird: its links in a manual topology, else the birds that heard it lately. Phones are in the room:
   * they hear every bird through the speakers, and every bird hears them through the computer's microphone.
   */
  const hearers = (id: number): number[] => {
    const out = new Set<number>();
    if (byId.get(id)?.kind === 'browser') {
      for (const n of nodes) if (n.node !== id) out.add(n.node);
    } else {
      if (store.topology?.manual) { for (const [a, b] of store.topology.links) if (a === id) out.add(b); }
      else for (const p of pulses.values()) { if (p.a === id) out.add(p.b); else if (p.b === id) out.add(p.a); }
      for (const p of phones) out.add(p);
    }
    return [...out].filter(alive);
  };

  const pos = (id: number): { x: number; y: number } => {
    const n = simNodes.current.get(id);
    const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
    return { x: clamp(n?.x ?? W / 2, R + 20, W - R - 20), y: clamp(n?.y ?? H / 2, R + 30, H - R - 50) };
  };

  // ---- the judge's hands on the graph: tap a bird to shoot it, drag between two birds to link or unlink them
  const toGraph = (e: PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const birdAt = (x: number, y: number): number | null => {
    let best: number | null = null;
    let bestD = R + 18;
    for (const n of nodes) {
      if (n.kind === 'browser') continue;
      const p = pos(n.node);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = n.node; }
    }
    return best;
  };
  const say = (text: string): void => {
    setNote(text);
    setTimeout(() => setNote((cur) => (cur === text ? null : cur)), 3500);
  };
  const shoot = (id: number): void => {
    const n = byId.get(id);
    if (!n || !n.online) return;
    if (!n.config.muted) shots.current.set(id, Date.now());
    sendCommand({ type: 'configure', node: id, patch: { muted: !n.config.muted } });
  };
  const link = async (a: number, b: number): Promise<void> => {
    const text = toggleLinkText(store.topology, a, b, [...pulses.values()].map((p) => [p.a, p.b]));
    if (text === null) { say('That is the last link. Draw another one first.'); return; }
    try {
      const r = await fetch('/api/topology', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      const body = await r.json() as TopologyView | { error: string };
      if (!r.ok || 'error' in body) { say('error' in body ? body.error : `HTTP ${r.status}`); return; }
      setTopology(body);
    } catch (err) {
      say((err as Error).message);
    }
  };
  const onDown = (e: PointerEvent): void => {
    if (store.disabled) return;
    const p = toGraph(e);
    const id = birdAt(p.x, p.y);
    if (id === null) return;
    drag.current = { from: id, x: p.x, y: p.y, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const p = toGraph(e);
    const o = pos(d.from);
    d.x = p.x;
    d.y = p.y;
    if (Math.hypot(p.x - o.x, p.y - o.y) > DRAG_MIN) d.moved = true;
  };
  const onUp = (e: PointerEvent): void => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const p = toGraph(e);
    const target = birdAt(p.x, p.y);
    if (!d.moved || target === d.from) shoot(d.from);
    else if (target !== null) void link(d.from, target);
  };
  const dragging = drag.current?.moved ? drag.current : null;
  const dragTarget = dragging ? birdAt(dragging.x, dragging.y) : null;
  const focusColor = focus === null ? 'var(--accent)' : messageColor(focus);

  return (
    <svg
      ref={svgRef} class="panel graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}
      style={{ touchAction: 'none' }}
    >
      <defs>
        {/* userSpaceOnUse: a bounding-box region is empty for a perfectly horizontal or vertical line */}
        <filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
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
      {trail.edges.map((ed) => {
        const a = pos(ed.from);
        const b = pos(ed.to);
        return (
          <line
            key={`t${ed.from}-${ed.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={focusColor} stroke-width="7" stroke-linecap="round" opacity="0.55" filter="url(#glow)"
          />
        );
      })}
      {songs.flatMap((sg) => {
        const a = pos(sg.node);
        const f = Math.min(1, Math.max(0, (now - sg.t) / sg.durationMs));
        const color = messageColor(sg.msgId);
        return hearers(sg.node).map((to) => {
          const b = pos(to);
          const at = (u: number): { x: number; y: number } => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
          const head = at(f);
          const tail = at(Math.max(0, f - 0.16));
          return (
            <g key={`d${sg.node}-${to}-${sg.t}`} filter="url(#glow)">
              <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={color} stroke-width="6" stroke-linecap="round" opacity="0.7" />
              <circle cx={head.x} cy={head.y} r="9" fill="#fff" stroke={color} stroke-width="4" />
            </g>
          );
        });
      })}
      {dragging && (() => {
        const a = pos(dragging.from);
        const b = dragTarget !== null && dragTarget !== dragging.from ? pos(dragTarget) : { x: dragging.x, y: dragging.y };
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffd54f" stroke-width="5" stroke-dasharray="10 8" stroke-linecap="round" />;
      })()}
      {nodes.map((n) => {
        const { x, y } = pos(n.node);
        const off = !n.online || n.config.muted;
        const shot = n.online && n.config.muted && !everyoneMuted && n.kind !== 'browser';
        const shotAge = now - (shots.current.get(n.node) ?? 0);
        const hop = trail.hops.get(n.node);
        const pr = progress.get(n.node);
        const frac = pr ? (pr.decoded ? 1 : Math.min(1, pr.rank / Math.max(1, pr.k))) : 0;
        const alias = store.state.aliasOf(n.node);
        const label = `#${n.node}${alias ? ` ${alias}` : ''}`;
        const color = off ? '#666' : speciesColor(n.species);
        const circ = 2 * Math.PI * (R + 8);
        return (
          <g
            key={n.node} transform={`translate(${x},${y})`} opacity={off ? 0.55 : 1}
            style={{ cursor: n.kind === 'browser' || store.disabled ? 'default' : 'crosshair' }}
          >
            {dragTarget === n.node && dragging && dragging.from !== n.node && (
              <circle r={R + 18} fill="none" stroke="#ffd54f" stroke-width="4" />
            )}
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
            {shot && (
              <g stroke="#ff5252" stroke-width="7" stroke-linecap="round">
                <line x1={-R * 0.62} y1={-R * 0.62} x2={R * 0.62} y2={R * 0.62} />
                <line x1={-R * 0.62} y1={R * 0.62} x2={R * 0.62} y2={-R * 0.62} />
              </g>
            )}
            {shot && shotAge < SHOT_MS && (
              <circle r={R + 6 + (shotAge / SHOT_MS) * 70} fill="none" stroke="#ff5252" stroke-width="6" opacity={1 - shotAge / SHOT_MS} />
            )}
            {hop !== undefined && (
              <g transform={`translate(${R + 4},${-R - 4})`}>
                <circle r="17" fill="var(--bg)" stroke={focusColor} stroke-width="3" />
                <text y="6" text-anchor="middle" font-size="17" font-weight="700" fill="var(--fg)">{hop}</text>
              </g>
            )}
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
      <text x="16" y={H - 14} font-size="17" fill={note ? '#ffd54f' : 'var(--fg)'} opacity={note ? 1 : 0.55}>
        {note ?? (store.disabled
          ? 'The network is down: the graph cannot see the birds.'
          : 'Tap a bird to shoot it (tap again to revive) · drag from bird to bird to link or unlink them · the number is the hop count')}
      </text>
    </svg>
  );
}
