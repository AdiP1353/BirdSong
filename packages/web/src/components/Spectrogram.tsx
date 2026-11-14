import { useEffect, useRef } from 'preact/hooks';
import { envBand } from '@birdsong/core';
import type { EnvName } from '@birdsong/core';

const MAX_HZ = 8000;

export function Spectrogram(props: { analyser: AnalyserNode; sampleRate: number; env: EnvName }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const bins = Math.min(props.analyser.frequencyBinCount, Math.floor(MAX_HZ / (props.sampleRate / 2) * props.analyser.frequencyBinCount));
    const data = new Uint8Array(props.analyser.frequencyBinCount);
    let raf = 0;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.drawImage(canvas, -1, 0);
      props.analyser.getByteFrequencyData(data);
      for (let y = 0; y < h; y++) {
        const bin = Math.floor(((h - 1 - y) / h) * bins);
        const v = data[bin]!;
        ctx.fillStyle = `rgb(${v},${Math.floor(v * 0.9)},${Math.floor(v * 0.5)})`;
        ctx.fillRect(w - 1, y, 1, 1);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [props.analyser, props.sampleRate]);
  const band = envBand(props.env);
  const pct = (hz: number) => `${(1 - Math.min(hz, MAX_HZ) / MAX_HZ) * 100}%`;
  return (
    <section class="panel">
      <h2>Spectrogram</h2>
      <div class="spec">
        <canvas ref={ref} width={400} height={160} />
        <div class="bandline" style={{ top: pct(band.highHz) }} />
        <div class="bandline" style={{ top: pct(band.lowHz) }} />
      </div>
    </section>
  );
}
