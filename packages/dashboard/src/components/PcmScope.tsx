import { useEffect, useRef, useState } from 'preact/hooks';
import { createSpectrum } from '@birdsong/core';

const RATE = 48_000;
const SIZE = 1024;

/**
 * Live spectrogram of the simulated air drawn straight from the ether's listen socket: no sound, no
 * AudioContext, so it runs on a phone without a tap. `url` is the ether's public base (ws://host:3100/ether).
 */
export function PcmScope(props: { url: string; height: number; topHz?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  const topHz = props.topHz ?? 9000;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext('2d')!;
    const spectrum = createSpectrum(SIZE);
    const ring = new Float32Array(SIZE * 2);
    let fresh = 0;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = (): void => {
      if (closed) return;
      ws = new WebSocket(`${props.url.replace(/^http/, 'ws').replace(/\/+$/, '')}/listen?x=1.5&y=0.5&noise=1`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => setLive(true);
      ws.onmessage = (m) => {
        const x = new Float32Array(m.data as ArrayBuffer);
        if (x.length >= ring.length) ring.set(x.subarray(x.length - ring.length));
        else { ring.copyWithin(0, x.length); ring.set(x, ring.length - x.length); }
        fresh += x.length;
      };
      ws.onclose = () => { setLive(false); if (!closed) retry = setTimeout(connect, 2000); };
      ws.onerror = () => ws?.close();
    };
    connect();
    const top = Math.floor((SIZE / 2) * Math.min(1, topHz / (RATE / 2)));
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      // One column per ~half FFT window of new sound, so the picture moves at the speed of the air.
      if (fresh < SIZE / 2) return;
      fresh = 0;
      const mags = spectrum(ring);
      const { width: w, height: h } = canvas;
      g.globalCompositeOperation = 'copy';
      g.drawImage(canvas, -2, 0);
      g.globalCompositeOperation = 'source-over';
      for (let y = 0; y < h; y++) {
        const k = Math.floor(((h - 1 - y) / h) * top);
        // -70 dB .. -10 dB
        const db = 20 * Math.log10(mags[k]! + 1e-9);
        const v = Math.min(1, Math.max(0, (db + 70) / 60));
        g.fillStyle = `rgb(${10 + 144 * v | 0},${12 + 197 * v | 0},${16 + 239 * v | 0})`;
        g.fillRect(w - 2, y, 2, 1);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      closed = true;
      cancelAnimationFrame(raf);
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [props.url, topHz]);
  return (
    <div class="pcmscope">
      <canvas ref={ref} width={360} height={props.height} />
      {!live && <div class="dim hint">Connecting to the air…</div>}
    </div>
  );
}
