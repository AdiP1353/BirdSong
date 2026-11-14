import type { AudioPort } from '@birdsong/core';

export function createEtherPort(opts: { url: string; id: number; x: number; y: number; sampleRate?: number }): AudioPort {
  const sampleRate = opts.sampleRate ?? 48000;
  let ws: WebSocket | null = null;
  let stopped = true;
  let volume = 1;
  let cb: ((pcm: Float32Array) => void) | null = null;
  let playEnd = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;

  function connect(onOpen?: () => void) {
    if (stopped) return;
    let sock: WebSocket;
    try {
      sock = new WebSocket(`${opts.url}/node?id=${opts.id}&x=${opts.x}&y=${opts.y}`);
    } catch {
      retry = setTimeout(() => connect(onOpen), 1000);
      return;
    }
    sock.binaryType = 'arraybuffer';
    let opened = false;
    let done = false;
    const lost = () => {
      if (done) return;
      done = true;
      if (ws === sock) ws = null;
      if (!stopped) retry = setTimeout(() => connect(opened ? undefined : onOpen), 1000);
    };
    sock.onopen = () => {
      if (stopped) { sock.close(); return; }
      opened = true;
      ws = sock;
      onOpen?.();
    };
    sock.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer && cb) cb(new Float32Array(ev.data));
    };
    sock.onerror = () => {};
    sock.onclose = lost;
  }

  return {
    sampleRate,
    start() {
      stopped = false;
      return new Promise<void>((resolve) => connect(resolve));
    },
    async stop() {
      stopped = true;
      if (retry) { clearTimeout(retry); retry = null; }
      if (ws) { ws.close(); ws = null; }
    },
    onInput(f) { cb = f; },
    play(pcm) {
      const out = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! * volume;
      if (ws && ws.readyState === 1) ws.send(out.buffer);
      const now = performance.now();
      const start = Math.max(now, playEnd);
      playEnd = start + (pcm.length / sampleRate) * 1000;
      return new Promise<void>((resolve) => setTimeout(resolve, playEnd - now));
    },
    setVolume(v) { volume = v; },
  };
}
