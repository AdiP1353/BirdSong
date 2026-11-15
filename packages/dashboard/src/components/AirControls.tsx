import { useEffect, useRef, useState } from 'preact/hooks';
import { air, setMuted, setVolume, subscribeAir } from '../air.ts';

function useAir(): void {
  const [, setV] = useState(0);
  useEffect(() => subscribeAir(() => setV((v) => v + 1)), []);
}

/** Header controls for the always-on sound of the simulated air. */
export function AirControls() {
  useAir();
  if (!air.available) return null;
  const silent = air.muted || air.volume === 0;
  return (
    <div class="air">
      <button class="icon" onClick={() => setMuted(!air.muted)} aria-label={silent ? 'Unmute chirps' : 'Mute chirps'} title={silent ? 'Unmute chirps' : 'Mute chirps'}>
        <SpeakerIcon muted={silent} />
      </button>
      <input
        type="range" min="0" max="1" step="0.05" value={air.muted ? 0 : air.volume} aria-label="Chirp volume"
        onInput={(e) => setVolume(Number(e.currentTarget.value))}
      />
      {air.blocked && !air.muted && <span class="hint-blink">click anywhere for sound</span>}
      <AirScope width={160} height={34} />
    </div>
  );
}

function SpeakerIcon(props: { muted: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
      {props.muted
        ? <><path d="m16 9 5 6" /><path d="m21 9-5 6" /></>
        : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>}
    </svg>
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
