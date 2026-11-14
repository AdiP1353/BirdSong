import { spawn, execFile } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AudioPort } from '@birdsong/core';

/** Re-aligns arbitrary byte chunks into whole float32 samples. */
export function createFloatChunker(): { push(buf: Uint8Array): Float32Array[] } {
  let rest = new Uint8Array(0);
  return {
    push(buf) {
      let all: Uint8Array;
      if (rest.length === 0) all = buf;
      else {
        all = new Uint8Array(rest.length + buf.length);
        all.set(rest, 0);
        all.set(buf, rest.length);
      }
      const aligned = all.length - (all.length % 4);
      rest = all.slice(aligned);
      if (aligned === 0) return [];
      const copy = new Uint8Array(aligned);
      copy.set(all.subarray(0, aligned));
      return [new Float32Array(copy.buffer, 0, aligned / 4)];
    },
  };
}

export function pulseAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile('pactl', ['info'], { timeout: 5000 }, (err) => resolve(!err));
    } catch {
      resolve(false);
    }
  });
}

function spawnPa(cmd: string, args: string[]): ChildProcessWithoutNullStreams {
  return spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

export function createPulsePort(opts: { sampleRate?: number; latencyMs?: number } = {}): AudioPort {
  const sampleRate = opts.sampleRate ?? 48000;
  const latencyMs = opts.latencyMs ?? 30;
  let rec: ChildProcessWithoutNullStreams | null = null;
  let play: ChildProcessWithoutNullStreams | null = null;
  let cb: ((pcm: Float32Array) => void) | null = null;
  let volume = 1;
  let prevEnd = 0;
  const common = ['--raw', '--format=float32le', `--rate=${sampleRate}`, '--channels=1', `--latency-msec=${latencyMs}`, '--client-name=birdsong'];

  return {
    sampleRate,
    async start() {
      const chunker = createFloatChunker();
      rec = spawnPa('parec', [...common, '--stream-name=mic']);
      play = spawnPa('pacat', ['--playback', ...common, '--stream-name=song']);
      const procs: [string, ChildProcessWithoutNullStreams][] = [['parec', rec], ['pacat', play]];
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => { settled = true; resolve(); }, 500);
        for (const [name, p] of procs) {
          let stderr = '';
          p.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
          p.stdin.on('error', () => {});
          p.on('error', (err) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            reject(new Error(`${name} failed to start: ${err.message}`));
          });
          p.on('exit', (code) => {
            if (settled) {
              if (stderr) console.error(`[audio] ${name} exited (${code}): ${stderr.trim()}`);
              return;
            }
            settled = true; clearTimeout(timer);
            reject(new Error(`${name} exited with code ${code} within 500 ms: ${stderr.trim()}`));
          });
        }
      }).catch((err) => {
        rec?.kill(); play?.kill();
        rec = null; play = null;
        throw err;
      });
      rec.stdout.on('data', (d: Buffer) => {
        for (const f of chunker.push(d)) cb?.(f);
      });
    },
    async stop() {
      rec?.kill();
      play?.kill();
      rec = null;
      play = null;
    },
    onInput(fn) { cb = fn; },
    async play(pcm) {
      const p = play;
      if (!p) throw new Error('pulse port not started');
      const out = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! * volume;
      const now = performance.now();
      const endAt = Math.max(now, prevEnd) + (pcm.length / sampleRate) * 1000;
      prevEnd = endAt;
      const ok = p.stdin.write(new Uint8Array(out.buffer));
      if (!ok) await new Promise<void>((r) => p.stdin.once('drain', () => r()));
      const wait = endAt + latencyMs - performance.now();
      if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    },
    setVolume(v) { volume = v; },
  };
}
