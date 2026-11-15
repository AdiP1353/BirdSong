/**
 * The simulated air, always playing. Connects to the ether's listen socket as soon as the page knows its URL
 * and keeps reconnecting. Browsers start audio only after a click or key press, so until then `blocked` is true
 * and incoming sound is dropped (not queued). To silence the birds, use "Stop birds" (hubClient.setStopped).
 */
const RATE = 48000;
const MAX_LEAD_S = 0.5;
const VOLUME = 0.8;

export interface Air {
  available: boolean;
  blocked: boolean;
  connected: boolean;
  analyser: AnalyserNode | null;
}

export const air: Air = { available: false, blocked: true, connected: false, analyser: null };

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
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    out = ctx.createGain();
    bus.connect(analyser);
    bus.connect(out);
    out.gain.value = VOLUME;
    out.connect(ctx.destination);
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
