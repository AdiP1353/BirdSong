import { useEffect, useState } from 'preact/hooks';
import { noise, setNoiseGain, startNoise, stopNoise, subscribeNoise } from '../noise.ts';
import type { NoiseSource } from '../noise.ts';
import { noiseVerdict, vsBirdsDb } from '../noiseLevel.ts';

const SOURCES: { id: NoiseSource; label: string }[] = [
  { id: 'mic', label: 'Microphone' },
  { id: 'room', label: 'Test room noise' },
];

/**
 * Add noise to the air every bird hears: this computer's microphone, or a synthetic busy room. Shows how loud
 * the noise is against a bird's song and what the tests say the birds can cope with.
 */
export function NoisePanel(props: { sources: number }) {
  const [, setV] = useState(0);
  useEffect(() => subscribeNoise(() => setV((v) => v + 1)), []);
  if (!noise.available) return null;

  const db = noise.source ? vsBirdsDb(noise.rms) : -Infinity;
  const verdict = noiseVerdict(db);
  // Meter: -30 dB .. +24 dB against a bird.
  const fill = noise.source && Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 30) / 54)) : 0;
  const birdMark = 30 / 54;
  const others = props.sources - (noise.source ? 1 : 0);

  return (
    <div class="panel noise">
      <h2>Add noise {props.sources > 0 && <span class="badge on">{props.sources} on</span>}</h2>
      <div class="hint">
        Mixes background noise into the air every bird hears, on top of their songs. Birds filter it: the band-pass
        and matched filters ignore most of it, and carrier sense waits only for tonal chirps, not for room noise.
      </div>
      <div class="seg start" role="group" aria-label="Noise source">
        {SOURCES.map((s) => (
          <button
            key={s.id} class={noise.source === s.id ? 'on' : ''} disabled={noise.starting}
            onClick={() => (noise.source === s.id ? stopNoise() : void startNoise(s.id))}
          >
            {noise.source === s.id ? `Stop ${s.label.toLowerCase()}` : s.label}
          </button>
        ))}
      </div>
      <label class="gain">
        <span>Gain <b>{noise.gainDb > 0 ? '+' : ''}{noise.gainDb} dB</b></span>
        <input
          type="range" min="-20" max="40" step="1" value={noise.gainDb} aria-label="Noise gain in dB"
          onInput={(e) => setNoiseGain(Number(e.currentTarget.value))}
          onChange={(e) => setNoiseGain(Number(e.currentTarget.value), true)}
        />
      </label>
      <div class="meter" title="Noise level against a bird's song (whole band)">
        <div class={`fill ${verdict.tone}`} style={{ width: `${fill * 100}%` }} />
        <div class="mark" style={{ left: `${birdMark * 100}%` }} title="A bird's song" />
      </div>
      <div class={`verdict ${noise.source ? verdict.tone : 'dim'}`}>
        {noise.starting ? 'Starting…' : noise.source
          ? <>Noise vs birds: <b>{Number.isFinite(db) ? `${db > 0 ? '+' : ''}${db.toFixed(0)} dB` : 'silent'}</b>. {verdict.text}</>
          : 'No noise from this tab.'}
      </div>
      {others > 0 && <div class="hint">{others} other tab{others > 1 ? 's are' : ' is'} also adding noise.</div>}
      {noise.source === 'mic' && <div class="hint">Your speakers no longer play the noise back (that would feed the microphone). Headphones help too.</div>}
      {noise.error && <div class="error">{noise.error}</div>}
    </div>
  );
}
