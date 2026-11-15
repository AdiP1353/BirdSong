import type { NodeConfig, NodeKind } from './types.ts';

/**
 * Observer channel. These events travel over the LAN to the dashboard for
 * visualisation only. Message data never travels this way.
 */
export type TelemetryEvent =
  /** alias: the person's name, sent by phones so the dashboard can label them. */
  | { type: 'hello'; node: number; species: number; kind: NodeKind; config: NodeConfig; t: number; alias?: string }
  | { type: 'config'; node: number; config: NodeConfig; t: number }
  | { type: 'heard'; node: number; from: number; msgId: number; seed: number; hop: number; k: number; sync: number; t: number }
  | { type: 'bad'; node: number; reason: 'crc' | 'netTag' | 'neighbor' | 'auth'; t: number }
  | { type: 'rank'; node: number; msgId: number; rank: number; k: number; t: number }
  | { type: 'decoded'; node: number; msgId: number; hops: number; text: string; alias: string; t: number }
  /** The node starts singing a frame that lasts durationMs (`sang` follows when it ends). */
  | { type: 'singing'; node: number; msgId: number; seed: number; hop: number; k: number; durationMs: number; t: number }
  | { type: 'sang'; node: number; msgId: number; seed: number; hop: number; k: number; airHex: string; durationMs: number; t: number }
  | { type: 'expired'; node: number; msgId: number; t: number }
  /** The node stopped (active: false) or resumed (active: true) relaying a message; count = receptions so far. */
  | { type: 'relay'; node: number; msgId: number; active: boolean; count: number; t: number };

export type Command =
  | { type: 'configure'; node: number | 'all'; patch: Partial<NodeConfig> }
  | { type: 'send'; node: number; text: string };

export interface NodeSnapshot {
  node: number;
  species: number;
  kind: NodeKind;
  config: NodeConfig;
  online: boolean;
  lastSeenAt: number;
  /** The name a phone gave when it joined (its hello), if any. */
  alias?: string;
}

/** The simulated air's current topology, as the ether reports it (GET /topology). */
export interface TopologyView {
  /** false = nodes hear by distance; true = only `links` carry sound. */
  manual: boolean;
  /** Canonical text form ("0-1" two-way, "4>5" one-way, one per line); "" in distance mode. */
  text: string;
  /** Directed links [speaker, listener]. */
  links: [number, number][];
}

/** Messages from the dashboard hub to a dashboard browser tab. */
export type HubToUi =
  | {
      type: 'snapshot'; nodes: NodeSnapshot[]; recent: TelemetryEvent[]; join: { pwaUrl: string; passphrase: string };
      /** The dashboard is disabled: the hub has cut off every node (see POST /api/disabled). */
      disabled: boolean;
      /** Noise sources (dashboard tabs feeding a microphone or test noise into the ether) right now. */
      noiseSources: number;
      /** "Stop birds" is on: the hub keeps every bird muted (see POST /api/stopped). */
      stopped: boolean;
    }
  | { type: 'event'; event: TelemetryEvent }
  | { type: 'nodeOffline'; node: number }
  | { type: 'topology'; topology: TopologyView }
  | { type: 'disabled'; disabled: boolean }
  /** A bird was removed from the flock (its container stopped); drop it from the view. */
  | { type: 'nodeRemoved'; node: number }
  /** The number of noise sources in the room changed. */
  | { type: 'noise'; sources: number }
  /** "Stop birds" was switched on or off. */
  | { type: 'stopped'; stopped: boolean };

/** Default ports. */
export const HUB_PORT = 3200;
/** Public port of the simulated mesh's reverse proxy. Keep in sync with docker/Caddyfile and docker/compose.sim.yml. */
export const PROXY_PORT = 3100;
export const ETHER_PORT = 7080;
export const NODE_UI_PORT = 8080;
