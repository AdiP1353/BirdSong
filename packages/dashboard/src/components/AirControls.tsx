import { useEffect, useRef, useState } from 'preact/hooks';
import { air, subscribeAir } from '../air.ts';

function useAir(): void {
  const [, setV] = useState(0);
  useEffect(() => subscribeAir(() => setV((v) => v + 1)), []);
}

/** Header strip for the always-on sound of the simulated air: a hint until the browser allows sound, and the spectrogram. */
export function AirControls() {
  useAir();
  if (!air.available) return null;
  return (
    <div class="air">
      {air.blocked && <span class="hint-blink">click anywhere for sound</span>}
      <AirScope width={160} height={34} />
    </div>
  );
}

/** Scrolling spectrogram of the air: shows chirps even with the sound muted or the dashboard disabled. */
export function AirScope(props: { width: number; height: number; class?: string }) {
  useAir();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const analyser = air.analyser;
    if (!canvas || !analyser) return;
    const g = canvas.getContext('2d')!;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    // 0..12 kHz of the 24 kHz Nyquist range, where the songs live.
    const top = Math.floor(bins.length / 2);
    let raf = 0;
    const draw = (): void => {
      analyser.getByteFrequencyData(bins);
      const { width: w, height: h } = canvas;
      // 'copy' replaces pixels instead of blending, so the history scrolls without piling up.
      g.globalCompositeOperation = 'copy';
      g.drawImage(canvas, -2, 0);
      g.globalCompositeOperation = 'source-over';
      for (let y = 0; y < h; y++) {
        const v = Math.min(1, (bins[Math.floor(((h - 1 - y) / h) * top)]! / 255) ** 2 * 1.6);
        // Opaque blend from the dark background (10,12,16) to the accent blue (154,209,255).
        g.fillStyle = `rgb(${10 + 144 * v | 0},${12 + 197 * v | 0},${16 + 239 * v | 0})`;
        g.fillRect(w - 2, y, 2, 1);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [air.analyser]);
  if (!air.analyser) return null;
  return <canvas ref={ref} class={`scope ${props.class ?? ''}`} width={props.width} height={props.height} title="The simulated air, live" />;
}
