/**
 * "Add noise": feed background noise into the simulated air, heard by every bird at gain 1 on top of their
 * songs. The source is this computer's microphone or a synthetic busy room (the same generator the tests use).
 * Samples go to the hub's /noise socket at 48 kHz in 20 ms blocks; the hub relays them to the ether.
 *
 * Filtering on the way in: the microphone is opened with the browser's echo cancellation on, so the chirps this
 * page plays are not picked up and sent back into the air as a delayed echo; noise suppression and automatic
 * gain stay off (they would remove the very noise we want). While the microphone is the source, the page's own
 * air playback leaves the noise out, so the speakers do not feed the microphone.
 *
 * "Hear phones" is different: it is not noise but a node. This tab stands in the simulated air as the phone
 * (the hub's /room socket, which is the phone's own node id in the ether). The microphone is that node's song,
 * and the speakers play what that node hears, which is only the birds linked to the phone. So the phone talks
 * along its edges like every bird, and the rest of the flock gets its message hop by hop. It runs without the
 * browser's echo cancellation (which can eat the near-end chirps it should pass) and relies on the echo gate
 * instead: the microphone is muted while the speakers play a bird, so the birds never hear themselves again.
 */
import { makeRoomNoise, mulberry32 } from '@birdsong/core';
import { echoGate, playRoom, setAirNoise, setRoomPlayback } from './air.ts';
import { createChunker, createResampler, dbToGain, BIRD_RMS } from './noiseLevel.ts';

export type NoiseSource = 'mic' | 'room' | 'phones';

const RATE = 48_000;
const BLOCK = 960; // 20 ms, the ether's block
/** The room noise at 0 dB gain sits 10 dB below a bird. */
const ROOM_BASE_RMS = BIRD_RMS * dbToGain(-10);

export interface NoiseState {
  available: boolean;
  source: NoiseSource | null;
  starting: boolean;
  gainDb: number;
  /** RMS of what is being sent, smoothed. */
  rms: number;
  /** "Hear phones": the echo gate is shut right now (a bird is playing through this computer's speakers). */
  gated: boolean;
  /** "Hear phones": the phone whose node this tab stands in for. */
  phone: number | null;
  error: string | null;
}

function loadGain(): number {
  try {
    const v = Number(localStorage.getItem('birdsong.dash.noiseGain'));
    if (localStorage.getItem('birdsong.dash.noiseGain') !== null && Number.isFinite(v)) return Math.max(-20, Math.min(40, v));
  } catch { /* private mode */ }
  return 10;
}

export const noise: NoiseState = { available: false, source: null, starting: false, gainDb: loadGain(), rms: 0, gated: false, phone: null, error: null };

const listeners = new Set<() => void>();
const changed = (): void => { for (const fn of listeners) fn(); };
export function subscribeNoise(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

fetch('/config.json').then((r) => r.json()).then((c: { noiseEditable?: boolean }) => {
  noise.available = !!c.noiseEditable;
  changed();
}, () => {});

let ws: WebSocket | null = null;
let stopSource: (() => void) | null = null;

const chunker = createChunker(BLOCK, (block, rms) => {
  noise.rms += 0.15 * (rms - noise.rms);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(block.buffer as ArrayBuffer);
});
chunker.gain = dbToGain(noise.gainDb);
let lastPaint = 0;
const paintSoon = (): void => {
  const now = performance.now();
  if (now - lastPaint > 100) { lastPaint = now; changed(); }
};

function announce(): void {
  if (ws && ws.readyState === WebSocket.OPEN && noise.source) ws.send(JSON.stringify({ source: noise.source, level: noise.gainDb }));
}

function openSocket(path = '/noise'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const s = new WebSocket(`${proto}://${location.host}${path}`);
    s.binaryType = 'arraybuffer';
    s.onmessage = (m) => { if (m.data instanceof ArrayBuffer) playRoom(new Float32Array(m.data)); };
    s.onopen = () => resolve(s);
    s.onerror = () => reject(new Error('The hub refused the noise source (is the ether running?)'));
    s.onclose = () => {
      if (ws === s) {
        ws = null;
        if (noise.source) {
          stop();
          noise.error = 'Lost the connection to the hub; the noise stopped.';
          changed();
        }
      }
    };
  });
}

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('birdsong-noise-capture', Capture);
`;

async function startMic(gated: boolean): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: !gated, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  // Use the device's own rate (Firefox will not connect a microphone to a context at another rate) and
  // resample to the ether's 48 kHz here.
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'birdsong-noise-capture', { numberOfOutputs: 1, outputChannelCount: [1] });
  const sink = ctx.createGain();
  sink.gain.value = 0; // keeps the worklet running without playing the microphone
  const rs = createResampler(ctx.sampleRate, RATE);
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const x = rs.push(e.data);
    if (gated) {
      noise.gated = !echoGate.open(performance.now());
      if (noise.gated) x.fill(0);
    }
    chunker.push(x);
    paintSoon();
  };
  src.connect(node);
  node.connect(sink);
  sink.connect(ctx.destination);
  await ctx.resume();
  return () => {
    node.port.onmessage = null;
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };
}

let roomTake: Float32Array | null = null;

function startRoom(): () => void {
  // 12 s of a busy room (people talking, a fan, mains hum, the odd click), looped.
  roomTake ??= (() => {
    const x = makeRoomNoise(12, RATE, mulberry32(2026));
    for (let i = 0; i < x.length; i++) x[i] = x[i]! * ROOM_BASE_RMS;
    return x;
  })();
  const take = roomTake;
  let at = 0;
  let sent = 0;
  const t0 = performance.now();
  const timer = setInterval(() => {
    const due = Math.floor(((performance.now() - t0) / 1000) * RATE);
    // After a stall (background tab), skip ahead instead of sending a burst.
    if (due - sent > RATE / 5) sent = due - BLOCK;
    while (sent + BLOCK <= due) {
      const n = Math.min(BLOCK, take.length - at);
      chunker.push(take.subarray(at, at + n));
      if (n < BLOCK) chunker.push(take.subarray(0, BLOCK - n));
      at = (at + BLOCK) % take.length;
      sent += BLOCK;
    }
    paintSoon();
  }, 20);
  return () => clearInterval(timer);
}

/** Start feeding `source` into the air (stopping any other source first). */
export async function startNoise(source: NoiseSource, phone: number | null = null): Promise<void> {
  stop();
  if (source === 'phones' && phone === null) return;
  noise.error = null;
  noise.starting = true;
  changed();
  try {
    ws = await openSocket(source === 'phones' ? `/room?id=${phone}` : '/noise');
    stopSource = source === 'room' ? startRoom() : await startMic(source === 'phones');
    noise.source = source;
    noise.phone = source === 'phones' ? phone : null;
    chunker.reset();
    setAirNoise(source === 'room');
    setRoomPlayback(source === 'phones');
    announce();
  } catch (err) {
    stop();
    const name = err instanceof DOMException ? err.name : '';
    noise.error = name === 'NotAllowedError' || name === 'SecurityError'
      ? 'Microphone access was denied. Allow it for this page (the icon in the address bar) and try again.'
      : name === 'NotFoundError' ? 'No microphone found. Try the test room noise instead.' : (err as Error).message;
  } finally {
    noise.starting = false;
    changed();
  }
}

function stop(): void {
  stopSource?.();
  stopSource = null;
  noise.source = null;
  noise.rms = 0;
  noise.gated = false;
  noise.phone = null;
  setAirNoise(true);
  setRoomPlayback(false);
  const s = ws;
  ws = null;
  s?.close();
}

export function stopNoise(): void {
  stop();
  changed();
}

/** Gain in dB applied to the source. `final` = the slider was released (logged on the hub). */
export function setNoiseGain(db: number, final = false): void {
  noise.gainDb = Math.max(-20, Math.min(40, db));
  chunker.gain = dbToGain(noise.gainDb);
  try { localStorage.setItem('birdsong.dash.noiseGain', String(noise.gainDb)); } catch { /* private mode */ }
  if (final) announce();
  changed();
}

const HEAR_PHONES_KEY = 'birdsong.dash.hearPhones';

/** "Hear phones" on (as `phone`'s node) or off, remembered: once switched off by hand, it does not start by itself again. */
export function setHearPhones(on: boolean, phone: number | null = null): Promise<void> {
  try { localStorage.setItem(HEAR_PHONES_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  if (on) return startNoise('phones', phone);
  if (noise.source === 'phones') stopNoise();
  return Promise.resolve();
}

/**
 * Start "Hear phones" by itself when a phone joins (and follow the phone if it changes), unless someone switched
 * it off on this computer, another noise source is on, or the page has had no click yet (browsers start audio
 * only after one; the first click retries). When the last phone leaves, it stops.
 */
export function autoHearPhones(phone: number | null): void {
  if (noise.source === 'phones') {
    if (phone === null) stopNoise();
    else if (noise.phone !== phone && !noise.starting) void startNoise('phones', phone);
    return;
  }
  if (phone === null || !noise.available || noise.source !== null || noise.starting || noise.error) return;
  try { if (localStorage.getItem(HEAR_PHONES_KEY) === 'off') return; } catch { /* private mode */ }
  if (!(navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) return;
  void startNoise('phones', phone);
}
