import { ENV_NAMES, formatTopology, parseTopology } from '@birdsong/core';
import type { EnvName, NodeSnapshot, TelemetryEvent, TopologyView } from '@birdsong/core';

export const SPECIES_COLORS = ['#e69f00', '#56b4e9', '#cc79a7', '#a6d854'];
export const speciesColor = (s: number): string => SPECIES_COLORS[s % SPECIES_COLORS.length]!;

export function dominantEnv(nodes: NodeSnapshot[]): EnvName {
  const counts = new Map<EnvName, number>();
  for (const n of nodes) if (n.online) counts.set(n.config.env, (counts.get(n.config.env) ?? 0) + 1);
  let best: EnvName = 'quiet';
  let bestN = 0;
  for (const e of ENV_NAMES) {
    const c = counts.get(e) ?? 0;
    if (c > bestN) {
      best = e;
      bestN = c;
    }
  }
  return best;
}

export function latestMsgId(events: TelemetryEvent[]): number | null {
  const seen = new Set<number>();
  let last: number | null = null;
  for (const e of events) {
    if ('msgId' in e && !seen.has(e.msgId)) {
      seen.add(e.msgId);
      last = e.msgId;
    }
  }
  return last;
}

/** The node that sang the message at hop 0, if any. */
export function originOf(events: TelemetryEvent[], msgId: number): number | null {
  for (const e of events) if (e.type === 'sang' && e.msgId === msgId && e.hop === 0) return e.node;
  for (const e of events) if (e.type === 'decoded' && e.msgId === msgId && e.hops === 0) return e.node;
  return null;
}

export interface Progress {
  rank: number;
  k: number;
  decoded: boolean;
}

export function progressFor(events: TelemetryEvent[], msgId: number | null): Map<number, Progress> {
  const out = new Map<number, Progress>();
  if (msgId === null) return out;
  for (const e of events) {
    if (!('msgId' in e) || e.msgId !== msgId) continue;
    if (e.type === 'rank') out.set(e.node, { rank: e.rank, k: e.k, decoded: out.get(e.node)?.decoded ?? false });
    else if (e.type === 'decoded') out.set(e.node, { rank: out.get(e.node)?.k ?? 1, k: out.get(e.node)?.k ?? 1, decoded: true });
  }
  return out;
}

export interface FeedMessage {
  msgId: number;
  text: string;
  alias: string;
  firstSangAt: number | null;
  firstAt: number;
  decodes: { node: number; hops: number; afterMs: number | null }[];
}

export function feed(events: TelemetryEvent[]): FeedMessage[] {
  const byId = new Map<number, FeedMessage>();
  const get = (id: number, t: number): FeedMessage => {
    let m = byId.get(id);
    if (!m) {
      m = { msgId: id, text: '', alias: '', firstSangAt: null, firstAt: t, decodes: [] };
      byId.set(id, m);
    }
    return m;
  };
  for (const e of events) {
    if (e.type === 'sang') {
      const m = get(e.msgId, e.t);
      if (m.firstSangAt === null) m.firstSangAt = e.t;
    } else if (e.type === 'decoded') {
      const m = get(e.msgId, e.t);
      m.text = e.text;
      m.alias = e.alias;
      if (!m.decodes.some((d) => d.node === e.node)) {
        m.decodes.push({ node: e.node, hops: e.hops, afterMs: m.firstSangAt === null ? null : e.t - m.firstSangAt });
      }
    }
  }
  return [...byId.values()].filter((m) => m.decodes.length > 0).reverse();
}

export function stats(nodes: NodeSnapshot[], events: TelemetryEvent[]) {
  const delivered = new Set<number>();
  let heard = 0;
  let crc = 0;
  for (const e of events) {
    if (e.type === 'heard') heard++;
    else if (e.type === 'bad' && e.reason === 'crc') crc++;
    else if (e.type === 'decoded') delivered.add(e.msgId);
  }
  return { online: nodes.filter((n) => n.online).length, heard, crc, delivered: delivered.size };
}

/** Latest relay state per node for one message: present only for nodes that stopped or resumed relaying it. */
export function relayFor(events: TelemetryEvent[], msgId: number | null): Map<number, { active: boolean; count: number }> {
  const out = new Map<number, { active: boolean; count: number }>();
  if (msgId === null) return out;
  for (const e of events) if (e.type === 'relay' && e.msgId === msgId) out.set(e.node, { active: e.active, count: e.count });
  return out;
}

export interface Singing { node: number; msgId: number; t: number; durationMs: number; hop: number }

/** Birds singing a frame right now (from `singing` events), newest per bird. */
export function singingNow(events: TelemetryEvent[], now: number): Singing[] {
  const by = new Map<number, Singing>();
  for (const e of events) {
    if (e.type === 'singing' && now - e.t < e.durationMs) by.set(e.node, { node: e.node, msgId: e.msgId, t: e.t, durationMs: e.durationMs, hop: e.hop });
    else if (e.type === 'sang') { const s = by.get(e.node); if (s && e.t >= s.t) by.delete(e.node); }
  }
  return [...by.values()];
}

export interface Trail {
  /** The path the message took: for each bird, the bird it first heard the message from. */
  edges: { from: number; to: number; t: number }[];
  /** Hops from the writer, for birds that decoded it. */
  hops: Map<number, number>;
}

/** Where one message has been: first-heard edges, and the hop count at every bird that decoded it. */
export function trailFor(events: TelemetryEvent[], msgId: number | null): Trail {
  const edges: Trail['edges'] = [];
  const hops = new Map<number, number>();
  if (msgId === null) return { edges, hops };
  const reached = new Set<number>();
  for (const e of events) {
    if (!('msgId' in e) || e.msgId !== msgId) continue;
    if (e.type === 'heard' && !reached.has(e.node)) {
      reached.add(e.node);
      edges.push({ from: e.from, to: e.node, t: e.t });
    } else if (e.type === 'decoded') {
      hops.set(e.node, e.hops);
      if (e.hops === 0) reached.add(e.node);
    }
  }
  return { edges, hops };
}

/** A stable colour for a message, so its glow can be told from another message's. */
export function messageColor(msgId: number): string {
  return `hsl(${(msgId * 137) % 360} 95% 68%)`;
}

/**
 * The topology text after linking or unlinking birds a and b (two-way), as when the judge drags a line on the
 * graph. In distance mode there are no links to edit, so the result starts from `observed` (pairs that heard
 * each other lately). Returns null when the edit would remove the last link (no links means distance mode).
 */
export function toggleLinkText(view: TopologyView | null, a: number, b: number, observed: [number, number][]): string | null {
  if (a === b) return view?.text ?? null;
  let links: [number, number][] = view?.manual
    ? view.links.map(([x, y]) => [x, y])
    : observed.flatMap(([x, y]): [number, number][] => [[x, y], [y, x]]);
  const linked = links.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  if (linked) links = links.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)));
  else links.push([a, b], [b, a]);
  if (links.length === 0) return null;
  const text = links.map(([x, y]) => `${x}>${y}`).join(' ');
  return formatTopology(parseTopology(text));
}
