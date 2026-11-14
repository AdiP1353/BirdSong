import { ENV_NAMES } from '@birdsong/core';
import type { EnvName, NodeSnapshot, TelemetryEvent } from '@birdsong/core';

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
