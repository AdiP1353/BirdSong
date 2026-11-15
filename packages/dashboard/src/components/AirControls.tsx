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

/**
 * Scrolling spectrogram of the air: shows chirps even before the browser allows sound.
 * With `reveal`, everything is drawn dim and the birds' own sound (without the camouflage ambience) is painted
 * on top in bright yellow, so chirps hidden in the ambience stand out.
 */
export function AirScope(props: { width: number; height: number; class?: string; reveal?: boolean; topHz?: number }) {
  useAir();
  const ref = useRef<HTMLCanvasElement>(null);
  const reveal = props.reveal ?? false;
  const topHz = props.topHz ?? 12_000;
  useEffect(() => {
    const canvas = ref.current;
    const analyser = air.analyser;
    const chirps = air.chirps;
    if (!canvas || !analyser || !chirps) return;
    const g = canvas.getContext('2d')!;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const own = new Uint8Array(chirps.frequencyBinCount);
    const top = Math.floor(bins.length * Math.min(1, topHz / 24_000));
    let raf = 0;
    const draw = (): void => {
      analyser.getByteFrequencyData(bins);
      if (reveal) chirps.getByteFrequencyData(own);
      const { width: w, height: h } = canvas;
      // 'copy' replaces pixels instead of blending, so the history scrolls without piling up.
      g.globalCompositeOperation = 'copy';
      g.drawImage(canvas, -2, 0);
      g.globalCompositeOperation = 'source-over';
      for (let y = 0; y < h; y++) {
        const k = Math.floor(((h - 1 - y) / h) * top);
        const v = Math.min(1, (bins[k]! / 255) ** 2 * 1.6);
        if (reveal) {
          const c = Math.min(1, (own[k]! / 255) ** 2 * 1.6);
          // Dim blue for everything; chirps on top in yellow (255,213,79).
          const d = v * 0.35;
          g.fillStyle = c > 0.12
            ? `rgb(${40 + 215 * c | 0},${40 + 173 * c | 0},${30 + 49 * c | 0})`
            : `rgb(${10 + 144 * d | 0},${12 + 197 * d | 0},${16 + 239 * d | 0})`;
        } else {
          // Opaque blend from the dark background (10,12,16) to the accent blue (154,209,255).
          g.fillStyle = `rgb(${10 + 144 * v | 0},${12 + 197 * v | 0},${16 + 239 * v | 0})`;
        }
        g.fillRect(w - 2, y, 2, 1);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [air.analyser, reveal, topHz]);
  if (!air.analyser) return null;
  return <canvas ref={ref} class={`scope ${props.class ?? ''}`} width={props.width} height={props.height} data-tip="The simulated air, live: pitch goes up the picture, time runs to the right. Each streak is a chirp." />;
}
