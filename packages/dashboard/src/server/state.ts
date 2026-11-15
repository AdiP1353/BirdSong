import { DEFAULT_NODE_CONFIG, SPECIES_COUNT } from '@birdsong/core';
import type { NodeSnapshot, TelemetryEvent } from '@birdsong/core';

const RING = 500;

export interface HubState {
  apply(event: TelemetryEvent, now: number): void;
  markOffline(node: number, now: number): void;
  /** Forget a node removed from the flock; frames still in the air will not bring it back as a phone. */
  remove(node: number): void;
  /** Undo remove() before a node is added again. */
  restore(node: number): void;
  load(nodes: NodeSnapshot[], recent: TelemetryEvent[]): void;
  snapshot(): NodeSnapshot[];
  recent(): TelemetryEvent[];
  aliasOf(node: number): string | null;
}

export function createHubState(): HubState {
  let nodes = new Map<number, NodeSnapshot>();
  let ring: TelemetryEvent[] = [];
  const aliases = new Map<number, string>();
  const removed = new Set<number>();

  function remember(event: TelemetryEvent): void {
    ring.push(event);
    if (ring.length > RING) ring = ring.slice(ring.length - RING);
    if (event.type === 'decoded' && event.hops === 0) aliases.set(event.node, event.alias);
  }

  return {
    apply(event, now) {
      if (event.type === 'hello') {
        removed.delete(event.node);
        nodes.set(event.node, {
          node: event.node, species: event.species, kind: event.kind,
          config: event.config, online: true, lastSeenAt: now,
        });
      } else {
        if (event.type === 'heard' && !nodes.has(event.from) && !removed.has(event.from)) {
          nodes.set(event.from, {
            node: event.from, species: event.from % SPECIES_COUNT, kind: 'browser',
            config: { ...DEFAULT_NODE_CONFIG }, online: true, lastSeenAt: now,
          });
        }
        const n = removed.has(event.node) ? undefined : nodes.get(event.node);
        if (n) {
          n.online = true;
          n.lastSeenAt = now;
          if (event.type === 'config') n.config = event.config;
        }
        if (event.type === 'heard') {
          const f = nodes.get(event.from);
          if (f) f.lastSeenAt = now;
        }
      }
      remember(event);
    },
    markOffline(node, now) {
      const n = nodes.get(node);
      if (n) {
        n.online = false;
        n.lastSeenAt = now;
      }
    },
    remove(node) {
      nodes.delete(node);
      removed.add(node);
    },
    restore(node) {
      removed.delete(node);
    },
    load(newNodes, recent) {
      nodes = new Map(newNodes.map((n) => [n.node, { ...n }]));
      ring = [];
      aliases.clear();
      for (const e of recent) remember(e);
    },
    snapshot() {
      return [...nodes.values()].sort((a, b) => a.node - b.node).map((n) => ({ ...n }));
    },
    recent() {
      return ring.slice();
    },
    aliasOf(node) {
      return aliases.get(node) ?? null;
    },
  };
}
