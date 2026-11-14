import { ENVS, ENV_NAMES, PROFILE_NAMES } from '@birdsong/core';
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
}) {
  const { nodes, events, focus } = props;

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
        <label>
          Environment
          <select value={props.env} onChange={(e) => configure('all', { env: e.currentTarget.value as EnvName })}>
            {ENV_NAMES.map((n) => <option value={n}>{ENVS[n].label}</option>)}
          </select>
        </label>
        <label>
          Profile
          <select value={props.profile} onChange={(e) => configure('all', { profile: e.currentTarget.value as ProfileName })}>
            {PROFILE_NAMES.map((n) => <option value={n}>{n}</option>)}
          </select>
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={props.camouflage}
            onChange={(e) => configure('all', { camouflage: e.currentTarget.checked })}
          />
          Camouflage
        </label>
      </div>
      <button class="kill" onClick={killTwo}>Kill 2 random relays</button>
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
