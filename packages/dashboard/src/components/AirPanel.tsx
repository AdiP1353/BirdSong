import { useEffect, useState } from 'preact/hooks';
import { AMBIENT_LEVEL, ENVS } from '@birdsong/core';
import type { EnvName } from '@birdsong/core';
import { air, setAmbient, subscribeAir } from '../air.ts';
import { sendCommand } from '../hubClient.ts';
import { AirScope } from './AirControls.tsx';

/**
 * The air, large, and the camouflage trick: hide the chirps inside jungle ambience ("can you hear the
 * message?"), then reveal them on the spectrogram.
 */
export function AirPanel(props: { env: EnvName; camouflage: boolean; disabled: boolean }) {
  const [, setV] = useState(0);
  const [reveal, setReveal] = useState(false);
  useEffect(() => subscribeAir(() => setV((v) => v + 1)), []);
  const bed = props.camouflage && AMBIENT_LEVEL[props.env] > 0;
  useEffect(() => { setAmbient(props.camouflage ? props.env : null); }, [props.camouflage, props.env]);

  const hide = (): void => {
    if (props.camouflage) sendCommand({ type: 'configure', node: 'all', patch: { camouflage: false } });
    else sendCommand({ type: 'configure', node: 'all', patch: { camouflage: true, ...(AMBIENT_LEVEL[props.env] > 0 ? {} : { env: 'jungle' as EnvName }) } });
  };

  return (
    <div class="panel airpanel">
      <div class="airpanel-head">
        <h2>The air{bed ? ` · hidden in ${ENVS[props.env].label.toLowerCase()} ambience` : ''}</h2>
        <button
          class={props.camouflage ? 'on' : ''} disabled={props.disabled} onClick={hide}
          data-tip="Camouflage: play jungle ambience under the chirps so the message hides in it."
        >
          {props.camouflage ? 'Stop hiding' : 'Hide the chirps in the jungle'}
        </button>
        <label class={`switch ${reveal ? 'on' : ''}`} data-tip="Paint the birds' own sound yellow and dim everything else.">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.currentTarget.checked)} />
          Reveal the chirps
        </label>
      </div>
      {air.analyser
        ? <AirScope width={900} height={220} class="wide" reveal={reveal} topHz={9000} />
        : <div class="dim">The air is not available (no ether).</div>}
      <div class="dim hint">
        {air.blocked ? 'Click anywhere to hear it. ' : ''}
        {bed
          ? (reveal ? 'Yellow = the birds. Everything else is ambience.' : 'Can you hear the message? Flip "Reveal the chirps".')
          : 'Low at the bottom, 9 kHz at the top. Each bright streak is one chirp.'}
      </div>
    </div>
  );
}
