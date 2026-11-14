import { useEffect, useRef, useState } from 'preact/hooks';

const RATE = 48000;

export function Listen() {
  const [etherUrl, setEtherUrl] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    fetch('/config.json').then((r) => r.json()).then(
      (c: { etherUrl?: string | null }) => setEtherUrl(c.etherUrl ?? null),
      () => {},
    );
    return () => cleanup.current?.();
  }, []);

  if (!etherUrl) return null;

  const toggle = (): void => {
    if (on) {
      cleanup.current?.();
      cleanup.current = null;
      setOn(false);
      return;
    }
    const ctx = new AudioContext({ sampleRate: RATE });
    const ws = new WebSocket(`${etherUrl.replace(/^http/, 'ws')}/listen?x=1.5&y=0.5`);
    ws.binaryType = 'arraybuffer';
    let next = 0;
    ws.onmessage = (m) => {
      const samples = new Float32Array(m.data as ArrayBuffer);
      const buf = ctx.createBuffer(1, samples.length, RATE);
      buf.copyToChannel(samples, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      next = Math.max(next, ctx.currentTime + 0.05);
      src.start(next);
      next += buf.duration;
    };
    cleanup.current = () => {
      ws.close();
      void ctx.close();
    };
    setOn(true);
  };

  return (
    <div class="panel">
      <button onClick={toggle}>{on ? 'Stop listening' : 'Listen to the simulated air'}</button>
    </div>
  );
}
