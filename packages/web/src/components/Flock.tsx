import { ENVS } from '@birdsong/core';
import type { NodeConfig, NodeState } from '@birdsong/core';
import type { Runtime } from '../runtime.ts';
import { Camouflage } from './Camouflage.tsx';
import { Compose } from './Compose.tsx';
import { Inbox, InFlight } from './Inbox.tsx';
import { Settings } from './Settings.tsx';
import { SongTools } from './SongTools.tsx';
import { Spectrogram } from './Spectrogram.tsx';

const SPECIES_COLORS = ['#ff8a65', '#ffd54f', '#81c784', '#ba68c8'];

export interface FlockProps {
  runtime: Runtime;
  state: NodeState;
  passphrase: string;
  alias: string;
  refresh(): void;
  configure(patch: Partial<NodeConfig>): void;
}

export function Flock({ runtime, state, passphrase, alias, refresh, configure }: FlockProps) {
  const cfg = state.config;
  const local = runtime.kind === 'local' && runtime.audio;
  return (
    <>
      <header class="panel head">
        <div>
          <strong>You are bird #{state.id}</strong> · <span style={{ color: SPECIES_COLORS[state.species % 4] }}>species {state.species}</span>
          <div class="dim">{ENVS[cfg.env].label} · {cfg.profile}</div>
        </div>
        <button onClick={() => configure({ muted: !cfg.muted })}>{cfg.muted ? 'Unmute' : 'Mute'}</button>
      </header>
      <Compose runtime={runtime} onSent={refresh} />
      <Inbox state={state} />
      <InFlight state={state} />
      {local && runtime.audio && (
        <>
          <Spectrogram analyser={runtime.audio.analyser} sampleRate={runtime.audio.context.sampleRate} env={cfg.env} />
          <Camouflage context={runtime.audio.context} env={cfg.env} volume={cfg.volume} />
          <SongTools state={state} passphrase={passphrase} alias={alias} sampleRate={runtime.audio.context.sampleRate} />
        </>
      )}
      <Settings config={cfg} onChange={configure} />
    </>
  );
}
