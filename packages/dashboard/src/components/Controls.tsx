import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_NODE_CONFIG, ENVS, ENV_NAMES, PROFILE_NAMES } from '@birdsong/core';
import type { EnvName, NodeConfig, NodeSnapshot, ProfileName, TelemetryEvent } from '@birdsong/core';
import { sendCommand } from '../hubClient.ts';
import { originOf } from '../derive.ts';

const configure = (node: number | 'all', patch: Partial<NodeConfig>): void =>
  sendCommand({ type: 'configure', node, patch });

export function Controls(props: {
  nodes: NodeSnapshot[];
  events: TelemetryEvent[];
  focus: number | null;
  env: EnvName;
  profile: ProfileName;
  camouflage: boolean;
  disabled?: boolean;
}) {
  const { nodes, events, focus } = props;
  const containers = nodes.filter((n) => n.online && n.kind !== 'browser');
  const limit = containers[0]?.config.relayLimit ?? DEFAULT_NODE_CONFIG.relayLimit;
  const mixed = containers.some((n) => n.config.relayLimit !== limit);
  const [draft, setDraft] = useState(String(limit));
  useEffect(() => setDraft(String(limit)), [limit]);
  const applyLimit = (): void => {
    const n = Math.floor(Number(draft));
    if (draft.trim() === '' || !Number.isFinite(n) || n < 0) { setDraft(String(limit)); return; }
    configure('all', { relayLimit: n });
  };

  const killTwo = (): void => {
    const origin = focus === null ? null : originOf(events, focus);
    const pool = nodes.filter((n) => n.online && n.kind !== 'browser' && !n.config.muted && n.node !== origin);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    for (const n of pool.slice(0, 2)) configure(n.node, { muted: true });
  };

  return (
    <div class="panel controls">
      <h2>Controls</h2>
      <div class="row">
        <label data-tip="The musical scale the birds sing in, and the ambience that goes with it. Every bird must use the same one.">
          Environment
          <select value={props.env} onChange={(e) => configure('all', { env: e.currentTarget.value as EnvName })}>
            {ENV_NAMES.map((n) => <option value={n}>{ENVS[n].label}</option>)}
          </select>
        </label>
        <label data-tip="fast: 3 s per frame, 32 chirp shapes. stealth: 9 s per frame, slower and more bird-like.">
          Profile
          <select value={props.profile} onChange={(e) => configure('all', { profile: e.currentTarget.value as ProfileName })}>
            {PROFILE_NAMES.map((n) => <option value={n}>{n}</option>)}
          </select>
        </label>
        <label class="check" data-tip="Birds play their environment's ambient sound under the chirps, so the message hides inside it. The quiet room has none.">
          <input
            type="checkbox"
            checked={props.camouflage}
            onChange={(e) => configure('all', { camouflage: e.currentTarget.checked })}
          />
          Camouflage
        </label>
      </div>
      <div class="row relay">
        <label data-tip="Relay limit. Once a bird has received a message more than this many times, it stops re-singing it. 0 means never stop.">
          Stop relaying after
          <span class="inline">
            <input
              type="number" min="0" step="1" value={draft} aria-label="Relay limit"
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyLimit(); }}
              onBlur={applyLimit}
            />
            receptions{mixed ? ' (mixed)' : ''}
          </span>
        </label>
        <span class="dim hint">A bird that has received a message more than N times stops singing it. 0 = never stop.</span>
      </div>
      <button class="kill" data-tip="Mutes two random birds (never the writer of the selected message) to show the message finds another way." onClick={killTwo}>Kill 2 random relays</button>
      <div class="nodes">
        {nodes.map((n) => (
          <div class="node-row" key={n.node}>
            <span class="node-id">#{n.node}</span>
            {n.kind === 'browser' ? (
              <span class="dim">phone</span>
            ) : (
              <>
                <button disabled={!n.online} onClick={() => configure(n.node, { muted: !n.config.muted })}>
                  {n.config.muted ? 'Unmute' : 'Mute'}
                </button>
                <input
                  type="range" min="0" max="1" step="0.05" value={n.config.volume} disabled={!n.online}
                  aria-label={`Volume of node ${n.node}`}
                  onChange={(e) => configure(n.node, { volume: Number(e.currentTarget.value) })}
                />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
