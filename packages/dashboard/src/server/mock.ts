import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { DEFAULT_NODE_CONFIG, FRAME_AIR_LEN, HUB_PORT, SPECIES_COUNT, toHex } from '@birdsong/core';
import type { Command, NodeConfig, TelemetryEvent } from '@birdsong/core';

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}
const hubUrl = arg('--hub', `ws://localhost:${HUB_PORT}`);
const N = Number(arg('--nodes', '8'));
const COLS = 4;
const CYCLE_MS = 60_000;
const K = 4;
const ALIASES = ['wren', 'robin', 'finch', 'lark', 'swift', 'tern'];
const TEXTS = ['meet at the north gate', 'the flock is listening', 'sing softly, travel far', 'all clear by the river'];

interface Fake {
  id: number;
  ws: WebSocket;
  config: NodeConfig;
  rank: number;
  decoded: boolean;
  hop: number;
  sungAt: number;
}

const neighbours = (id: number): number[] => {
  const r = Math.floor(id / COLS);
  const c = id % COLS;
  const out: number[] = [];
  for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    const rr = r + dr;
    const cc = c + dc;
    const j = rr * COLS + cc;
    if (cc >= 0 && cc < COLS && rr >= 0 && j >= 0 && j < N) out.push(j);
  }
  return out;
};

const fakes: Fake[] = [];
type NoT<T> = T extends unknown ? Omit<T, 't'> : never;
const send = (f: Fake, e: NoT<TelemetryEvent>): void => {
  if (f.ws.readyState === WebSocket.OPEN) f.ws.send(JSON.stringify({ ...e, t: Date.now() }));
};

for (let id = 0; id < N; id++) {
  const ws = new WebSocket(`${hubUrl.replace(/\/$/, '')}/node`);
  const f: Fake = { id, ws, config: { ...DEFAULT_NODE_CONFIG }, rank: 0, decoded: false, hop: 0, sungAt: 0 };
  fakes.push(f);
  ws.on('open', () => send(f, { type: 'hello', node: id, species: id % SPECIES_COUNT, kind: 'sim', config: f.config }));
  ws.on('message', (d) => {
    const cmd = JSON.parse(d.toString()) as Command;
    if (cmd.type !== 'configure') return;
    f.config = { ...f.config, ...cmd.patch };
    send(f, { type: 'config', node: id, config: f.config });
  });
  ws.on('error', () => {});
}

const timers: ReturnType<typeof setTimeout>[] = [];
const later = (ms: number, fn: () => void): void => {
  timers.push(setTimeout(fn, ms));
};

function sing(f: Fake, msgId: number, hop: number): void {
  if (f.config.muted || f.ws.readyState !== WebSocket.OPEN) return;
  const seed = Math.floor(Math.random() * 255);
  send(f, {
    type: 'sang', node: f.id, msgId, seed, hop, k: K,
    airHex: toHex(randomBytes(FRAME_AIR_LEN)), durationMs: 2400,
  });
  for (const nb of neighbours(f.id)) {
    const g = fakes[nb]!;
    later(800 + Math.random() * 400, () => hear(g, f, msgId, seed, hop));
  }
}

function hear(g: Fake, from: Fake, msgId: number, seed: number, hop: number): void {
  if (g.config.muted || from.config.muted || g.ws.readyState !== WebSocket.OPEN) return;
  send(g, { type: 'heard', node: g.id, from: from.id, msgId, seed, hop: hop + 1, k: K, sync: 0.6 + Math.random() * 0.3 });
  if (g.decoded) return;
  g.rank++;
  g.hop = hop + 1;
  send(g, { type: 'rank', node: g.id, msgId, rank: g.rank, k: K });
  if (g.rank >= K) {
    g.decoded = true;
    send(g, { type: 'decoded', node: g.id, msgId, hops: g.hop, text: TEXTS[msgId % TEXTS.length]!, alias: ALIASES[msgId % ALIASES.length]! });
    for (let i = 0; i < K; i++) later(i * 3000 + Math.random() * 500, () => sing(g, msgId, g.hop));
  }
}

let cycle = 0;
function startCycle(): void {
  const msgId = 1000 + cycle++;
  for (const f of fakes) {
    f.rank = 0;
    f.decoded = false;
    f.hop = 0;
    f.config = { ...f.config, muted: false };
    send(f, { type: 'config', node: f.id, config: f.config });
  }
  const origin = fakes[0];
  if (!origin || origin.ws.readyState !== WebSocket.OPEN) return;
  origin.decoded = true;
  origin.rank = K;
  send(origin, { type: 'decoded', node: 0, msgId, hops: 0, text: TEXTS[msgId % TEXTS.length]!, alias: ALIASES[msgId % ALIASES.length]! });
  for (let i = 0; i < 8; i++) later(i * 3000, () => sing(origin, msgId, 0));
}

setTimeout(startCycle, 1500);
setInterval(startCycle, CYCLE_MS);
console.log(`mock flock: ${N} nodes -> ${hubUrl}`);
