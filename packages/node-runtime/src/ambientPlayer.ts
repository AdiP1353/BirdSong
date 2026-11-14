import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { AMBIENT_LEVEL, renderAmbient } from '@birdsong/core';
import type { EnvName } from '@birdsong/core';

export interface AmbientPlayer {
  setEnv(env: EnvName): void;
  /** Output volume multiplier (the node's volume, 0..1). */
  setLevel(gain: number): void;
  start(): void;
  stop(): void;
}

const SLICE_S = 0.5;
const AHEAD_S = 1.5;

export function createAmbientPlayer(opts: { sampleRate: number }): AmbientPlayer {
  const sr = opts.sampleRate;
  const cache = new Map<EnvName, Float32Array>();
  let env: EnvName = 'quiet';
  let volume = 0.8;
  let proc: ChildProcessByStdio<Writable, null, Readable> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pos = 0;
  let queuedUntil = 0; // performance.now() ms at which queued audio runs out
  let disabled = false;
  let waiting = false;

  function bed(e: EnvName): Float32Array | null {
    if (disabled) return null;
    let b = cache.get(e);
    if (!b) {
      try {
        b = renderAmbient(e, 20, sr, 1);
      } catch (err) {
        console.warn(`[ambient] renderAmbient unavailable, ambient playback disabled: ${(err as Error).message}`);
        disabled = true;
        return null;
      }
      cache.set(e, b);
    }
    return b;
  }

  function tick() {
    timer = null;
    if (!proc) return;
    const p = proc;
    const buf = bed(env);
    if (!buf) return;
    const gain = AMBIENT_LEVEL[env] * volume;
    const now = performance.now();
    if (queuedUntil < now) queuedUntil = now;
    let guard = 0;
    while (queuedUntil - now < AHEAD_S * 1000 && guard++ < 8) {
      const n = Math.round(SLICE_S * sr);
      const slice = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        slice[i] = buf[pos]! * gain;
        pos = (pos + 1) % buf.length;
      }
      queuedUntil += SLICE_S * 1000;
      if (!p.stdin.write(new Uint8Array(slice.buffer))) {
        if (!waiting) {
          waiting = true;
          p.stdin.once('drain', () => { waiting = false; schedule(); });
        }
        return;
      }
    }
    schedule();
  }

  function schedule() {
    if (timer || !proc || waiting) return;
    timer = setTimeout(tick, 250);
  }

  return {
    setEnv(e) {
      if (e !== env) { env = e; pos = 0; }
    },
    setLevel(g) { volume = g; },
    start() {
      if (proc || bed(env) === null && disabled) return;
      const child = proc = spawn('pacat', ['--playback', '--raw', '--format=float32le', `--rate=${sr}`, '--channels=1',
        '--client-name=birdsong', '--stream-name=ambient'], { stdio: ['pipe', 'ignore', 'pipe'] });
      child.stdin.on('error', () => {});
      child.on('error', (err) => console.warn(`[ambient] pacat failed: ${err.message}`));
      child.on('exit', () => { if (proc === child) proc = null; });
      queuedUntil = 0;
      tick();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      waiting = false;
      proc?.kill();
      proc = null;
    },
  };
}
