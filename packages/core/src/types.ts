import type { EnvName, ProfileName } from './envs.ts';
import type { TelemetryEvent } from './telemetry.ts';

/** A speaker + microphone pair. Samples are mono Float32 in -1..1. */
export interface AudioPort {
  readonly sampleRate: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Register the single microphone callback. Chunk sizes are arbitrary. */
  onInput(cb: (pcm: Float32Array) => void): void;
  /** Play samples. Resolves when playback has finished. Calls are queued. */
  play(pcm: Float32Array): Promise<void>;
  /** Output gain, 0..1. */
  setVolume(v: number): void;
}

export type TimerId = number;
export interface Clock {
  /** Milliseconds. Only differences are meaningful. */
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
}

/** One droplet with its routing header. `payload` is BLOCK_SIZE bytes. */
export interface Frame {
  netTag: number; // 0..255, identifies the channel
  msgId: number; // 0..65535
  k: number; // 1..15 source blocks. 0 is reserved for control frames.
  hop: number; // 0..15, hops from the originator to the sender of this frame
  seed: number; // 0..254
  sender: number; // 0..255 node id
  payload: Uint8Array;
}

export interface RxMeta {
  /** Normalised sync correlation, 0..1. */
  sync: number;
  /** Mean per-symbol decision margin, 0..1. */
  confidence: number;
  /** Absolute input sample index where the sync began. */
  startSample: number;
  symbols: number[];
}

export interface ModemOptions {
  sampleRate: number;
  env: EnvName;
  profile: ProfileName;
  /** Minimum sync correlation to accept. Default 0.25. */
  syncThreshold?: number;
}

/** Turns FRAME_AIR_LEN bytes into sound and sound back into bytes. */
export interface Modem {
  readonly sampleRate: number;
  /** `air.length` must equal FRAME_AIR_LEN. Returns one whole frame of audio. */
  encode(air: Uint8Array, species: number): Float32Array;
  /** Feed microphone samples. May call the onFrame callback synchronously. */
  push(pcm: Float32Array): void;
  /** Called once per detected frame with FRAME_AIR_LEN demodulated bytes. The bytes may contain errors. */
  onFrame(cb: (air: Uint8Array, meta: RxMeta) => void): void;
  /** True while a frame is arriving or the channel recently had in-band energy. Used for listen-before-sing. */
  busy(): boolean;
  /** Drop all buffered input and pending detections. */
  reset(): void;
}
export type ModemFactory = (opts: ModemOptions) => Modem;

export type NodeKind = 'container' | 'browser' | 'sim';

export interface NodeConfig {
  env: EnvName;
  profile: ProfileName;
  volume: number; // 0..1
  /** A muted node neither sings nor listens. Used as the demo "kill switch". */
  muted: boolean;
  /** If not null, frames from sender ids outside this list are ignored. */
  neighbors: number[] | null;
  /** Whether the runtime should play the ambient bed. The engine only stores it. */
  camouflage: boolean;
}

export interface MessageStatus {
  msgId: number;
  k: number;
  rank: number;
  decoded: boolean;
  /** This node's distance from the originator in hops. 0 = I wrote it. */
  hop: number;
  firstSeenAt: number;
  heard: number; // valid droplets received
  sang: number; // droplets transmitted
}

export interface InboxMessage {
  msgId: number;
  text: string;
  alias: string;
  hops: number;
  receivedAt: number;
  mine: boolean;
}

export interface NodeState {
  id: number;
  species: number;
  kind: NodeKind;
  config: NodeConfig;
  messages: MessageStatus[];
  inbox: InboxMessage[];
}

export interface BirdNodeOptions {
  id: number; // 0..255
  kind: NodeKind;
  passphrase: string;
  alias?: string;
  config: NodeConfig;
  port: AudioPort;
  clock: Clock;
  /** Uniform random in [0, 1). Injected so simulations are reproducible. */
  rng: () => number;
  modemFactory: ModemFactory;
}

export interface BirdNode {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Encrypt, encode and start gossiping a message. Resolves with its msgId. */
  send(text: string): Promise<number>;
  configure(patch: Partial<NodeConfig>): Promise<void>;
  state(): NodeState;
  onEvent(cb: (e: TelemetryEvent) => void): void;
  /** Resolves when no internal async work (crypto, decode) is pending. */
  settled(): Promise<void>;
}

export const DEFAULT_NODE_CONFIG: NodeConfig = {
  env: 'quiet',
  profile: 'fast',
  volume: 0.8,
  muted: false,
  neighbors: null,
  camouflage: false,
};
