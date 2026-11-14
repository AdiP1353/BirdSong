import { useEffect, useState } from 'preact/hooks';
import { AMBIENT_LEVEL, renderAmbient } from '@birdsong/core';
import type { EnvName } from '@birdsong/core';

export function Camouflage(props: { context: AudioContext; env: EnvName; volume: number }) {
  const [on, setOn] = useState(false);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (!on) return;
    let src: AudioBufferSourceNode | null = null;
    try {
      const pcm = renderAmbient(props.env, 20, props.context.sampleRate, 1);
      const buf = props.context.createBuffer(1, pcm.length, props.context.sampleRate);
      buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
      const gain = props.context.createGain();
      gain.gain.value = AMBIENT_LEVEL[props.env] * props.volume;
      gain.connect(props.context.destination);
      src = props.context.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start();
    } catch {
      setAvailable(false);
      setOn(false);
    }
    return () => src?.stop();
  }, [on, props.env, props.volume, props.context]);
  if (!available) return null;
  return (
    <section class="panel">
      <label class="check"><input type="checkbox" checked={on} onChange={(e) => setOn(e.currentTarget.checked)} /> Camouflage (play ambient bed)</label>
    </section>
  );
}
