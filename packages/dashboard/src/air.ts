/**
 * The simulated air, always playing. Connects to the ether's listen socket as soon as the page knows its URL
 * and keeps reconnecting. Browsers start audio only after a click or key press, so until then `blocked` is true
 * and incoming sound is dropped (not queued). To silence the birds, use "Stop birds" (hubClient.setStopped).
 */
import { AMBIENT_LEVEL, renderAmbient } from '@birdsong/core';
import type { EnvName } from '@birdsong/core';
import { createEchoGate, rmsOf } from './noiseLevel.ts';

const RATE = 48000;
const MAX_LEAD_S = 0.5;
const VOLUME = 0.8;

export interface Air {
  available: boolean;
  blocked: boolean;
  connected: boolean;
  /** Everything this page plays: the birds, plus the camouflage ambience when it is on. */
  analyser: AnalyserNode | null;
  /** The birds (and injected noise) alone, without the ambience: what "reveal the chirps" highlights. */
  chirps: AnalyserNode | null;
  /** Environment whose ambience is playing, or null. */
  ambient: EnvName | null;
}

/** Shut while this page's speakers play a bird; "Hear phones" passes the microphone only while it is open. */
export const echoGate = createEchoGate();

export const air: Air = { available: false, blocked: true, connected: false, analyser: null, chirps: null, ambient: null };

const listeners = new Set<() => void>();
const changed = (): void => { for (const fn of listeners) fn(); };
export function subscribeAir(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let bus: GainNode | null = null;
let next = 0;
let mix: GainNode | null = null;
let bed: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let wantAmbient: EnvName | null = null;

/**
 * Camouflage: loop the environment's ambient bed under the birds, as a camouflaged bird's speaker would.
 * null (or an environment with no bed, like the quiet room) stops it.
 */
export function setAmbient(env: EnvName | null): void {
  wantAmbient = env !== null && AMBIENT_LEVEL[env] > 0 ? env : null;
  if (!ctx || !mix || wantAmbient === air.ambient) return;
  if (bed) {
    try { bed.src.stop(); } catch { /* not started */ }
    bed.gain.disconnect();
    bed = null;
  }
  air.ambient = wantAmbient;
  if (wantAmbient) {
    const pcm = renderAmbient(wantAmbient, 20, RATE, 1);
    const buf = ctx.createBuffer(1, pcm.length, RATE);
    buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
    const gain = ctx.createGain();
    gain.gain.value = AMBIENT_LEVEL[wantAmbient];
    gain.connect(mix);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start();
    bed = { src, gain };
  }
  changed();
}

let sock: WebSocket | null = null;
/** Whether the playback includes the ether's noise sources (off while this page's microphone feeds them). */
let withNoise = true;

/**
 * Include the injected noise in what this page plays, or not. Off while the microphone is the noise source:
 * playing the room back through the speakers would feed the microphone again (a feedback loop).
 */
export function setAirNoise(include: boolean): void {
  if (include === withNoise) return;
  withNoise = include;
  if (sock) sock.close(); // reconnects at once with the new setting
}

function unlock(): void {
  if (!ctx || ctx.state === 'running') return;
  void ctx.resume().then(() => {
    air.blocked = ctx!.state !== 'running';
    changed();
  }, () => {});
}

function connect(url: string): void {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws').replace(/\/+$/, '')}/listen?x=1.5&y=0.5&noise=${withNoise ? 1 : 0}`);
  sock = ws;
  const wanted = withNoise;
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { air.connected = true; changed(); };
  ws.onmessage = (m) => {
    if (!ctx || !bus || ctx.state !== 'running') return;
    const samples = new Float32Array(m.data as ArrayBuffer);
    if (samples.length === 0) return;
    const now = ctx.currentTime;
    if (next < now + 0.05) next = now + 0.05;
    if (next > now + MAX_LEAD_S) return; // fell behind: drop rather than drift
    const buf = ctx.createBuffer(1, samples.length, RATE);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(bus);
    src.start(next);
    next += buf.duration;
    echoGate.played(rmsOf(samples), performance.now() + (next - now) * 1000);
  };
  ws.onclose = () => {
    if (sock === ws) sock = null;
    air.connected = false;
    changed();
    // A deliberate reconnect (the noise setting changed) goes at once; a lost connection retries after 2 s.
    setTimeout(() => connect(url), wanted !== withNoise ? 0 : 2000);
  };
  ws.onerror = () => ws.close();
}

/** Start the air once. Safe to call more than once. */
export function startAir(): void {
  if (ctx) return;
  fetch('/config.json').then((r) => r.json()).then((c: { etherUrl?: string | null }) => {
    if (!c.etherUrl || ctx) return;
    ctx = new AudioContext({ sampleRate: RATE });
    bus = ctx.createGain();
    mix = ctx.createGain();
    const mk = (): AnalyserNode => {
      const a = ctx!.createAnalyser();
      a.fftSize = 1024;
      a.smoothingTimeConstant = 0.2;
      return a;
    };
    const analyser = mk();
    const chirps = mk();
    out = ctx.createGain();
    bus.connect(chirps);
    bus.connect(mix);
    mix.connect(analyser);
    mix.connect(out);
    out.gain.value = VOLUME;
    out.connect(ctx.destination);
    air.analyser = analyser;
    air.chirps = chirps;
    if (wantAmbient) setAmbient(wantAmbient);
    air.available = true;
    air.blocked = ctx.state !== 'running';
    ctx.onstatechange = () => { air.blocked = ctx!.state !== 'running'; changed(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      document.addEventListener(ev, unlock, { capture: true, passive: true });
    }
    connect(c.etherUrl);
    changed();
  }, () => {});
}
