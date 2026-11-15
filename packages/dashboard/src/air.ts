/**
 * The simulated air, always playing. Connects to the ether's listen socket as soon as the page knows its URL
 * and keeps reconnecting. Browsers start audio only after a click or key press, so until then `blocked` is true
 * and incoming sound is dropped (not queued). Volume and mute are remembered per browser.
 */
const RATE = 48000;
const MAX_LEAD_S = 0.5;

export interface Air {
  available: boolean;
  blocked: boolean;
  connected: boolean;
  volume: number;
  muted: boolean;
  analyser: AnalyserNode | null;
}

export const air: Air = { available: false, blocked: true, connected: false, volume: 0.8, muted: false, analyser: null };

const listeners = new Set<() => void>();
const changed = (): void => { for (const fn of listeners) fn(); };
export function subscribeAir(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function load(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* private mode */ }
}
{
  const v = Number(load('birdsong.dash.volume'));
  if (load('birdsong.dash.volume') !== null && Number.isFinite(v)) air.volume = Math.min(1, Math.max(0, v));
  air.muted = load('birdsong.dash.muted') === '1';
}

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let bus: GainNode | null = null;
let next = 0;

function applyGain(): void {
  if (out && ctx) out.gain.setTargetAtTime(air.muted ? 0 : air.volume, ctx.currentTime, 0.02);
}

export function setVolume(v: number): void {
  air.volume = Math.min(1, Math.max(0, v));
  if (air.volume > 0) air.muted = false;
  save('birdsong.dash.volume', String(air.volume));
  save('birdsong.dash.muted', air.muted ? '1' : '0');
  applyGain();
  changed();
}

export function setMuted(m: boolean): void {
  air.muted = m;
  save('birdsong.dash.muted', m ? '1' : '0');
  applyGain();
  unlock();
  changed();
}

function unlock(): void {
  if (!ctx || ctx.state === 'running') return;
  void ctx.resume().then(() => {
    air.blocked = ctx!.state !== 'running';
    changed();
  }, () => {});
}

function connect(url: string): void {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws').replace(/\/+$/, '')}/listen?x=1.5&y=0.5`);
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
  };
  ws.onclose = () => {
    air.connected = false;
    changed();
    setTimeout(() => connect(url), 2000);
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
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    out = ctx.createGain();
    bus.connect(analyser);
    bus.connect(out);
    out.connect(ctx.destination);
    applyGain();
    air.analyser = analyser;
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
