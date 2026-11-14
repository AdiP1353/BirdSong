import { ENVS, ENV_NAMES, PROFILE_NAMES } from '@birdsong/core';
import type { EnvName, NodeConfig, ProfileName } from '@birdsong/core';

export function Settings(props: { config: NodeConfig; onChange(patch: Partial<NodeConfig>): void }) {
  const c = props.config;
  return (
    <details class="panel">
      <summary>Settings</summary>
      <label>Environment
        <select value={c.env} onChange={(e) => props.onChange({ env: e.currentTarget.value as EnvName })}>
          {ENV_NAMES.map((n) => <option value={n}>{ENVS[n].label}</option>)}
        </select>
      </label>
      <label>Profile
        <select value={c.profile} onChange={(e) => props.onChange({ profile: e.currentTarget.value as ProfileName })}>
          {PROFILE_NAMES.map((n) => <option value={n}>{n}</option>)}
        </select>
      </label>
      <label>Volume
        <input type="range" min="0" max="1" step="0.05" value={c.volume} onInput={(e) => props.onChange({ volume: Number(e.currentTarget.value) })} />
      </label>
    </details>
  );
}
