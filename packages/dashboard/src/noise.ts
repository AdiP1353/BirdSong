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
 * "Hear phones" is the microphone used as an ear for the room rather than as noise: phones sing through their
 * speakers, this computer's microphone picks them up, and the simulated birds hear them. It runs without the
 * browser's echo cancellation (which can eat the near-end chirps it should pass) and relies on the echo gate
 * instead: the microphone is muted while this page's speakers play a bird, so the birds never hear themselves
 * again. The page's air playback leaves the microphone out here too, so the phone is not played back either.
 */
import { makeRoomNoise, mulberry32 } from '@birdsong/core';
import { echoGate, setAirNoise } from './air.ts';
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
  error: string | null;
}

function loadGain(): number {
  try {
    const v = Number(localStorage.getItem('birdsong.dash.noiseGain'));
    if (localStorage.getItem('birdsong.dash.noiseGain') !== null && Number.isFinite(v)) return Math.max(-20, Math.min(40, v));
  } catch { /* private mode */ }
  return 10;
}

export const noise: NoiseState = { available: false, source: null, starting: false, gainDb: loadGain(), rms: 0, gated: false, error: null };

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

function openSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const s = new WebSocket(`${proto}://${location.host}/noise`);
    s.binaryType = 'arraybuffer';
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
export async function startNoise(source: NoiseSource): Promise<void> {
  stop();
  noise.error = null;
  noise.starting = true;
  changed();
  try {
    ws = await openSocket();
    stopSource = source === 'room' ? startRoom() : await startMic(source === 'phones');
    noise.source = source;
    chunker.reset();
    setAirNoise(source === 'room');
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
  setAirNoise(true);
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

/** "Hear phones" on or off, remembered: once switched off by hand, it does not start by itself again. */
export function setHearPhones(on: boolean): Promise<void> {
  try { localStorage.setItem(HEAR_PHONES_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  if (on) return startNoise('phones');
  if (noise.source === 'phones') stopNoise();
  return Promise.resolve();
}

/**
 * Start "Hear phones" by itself when a phone joins, unless someone switched it off on this computer, another noise
 * source is on, or the page has had no click yet (browsers start audio only after one; the first click retries).
 */
export function autoHearPhones(phoneOnline: boolean): void {
  if (!phoneOnline || !noise.available || noise.source !== null || noise.starting || noise.error) return;
  try { if (localStorage.getItem(HEAR_PHONES_KEY) === 'off') return; } catch { /* private mode */ }
  if (!(navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive) return;
  void startNoise('phones');
}
