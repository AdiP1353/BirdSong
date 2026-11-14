import { useState } from 'preact/hooks';
import { ENVS, ENV_NAMES, MAX_ALIAS_CHARS, PROFILE_NAMES } from '@birdsong/core';
import type { EnvName, ProfileName } from '@birdsong/core';
import type { JoinParams } from '../join.ts';

export interface JoinProps {
  initial: Partial<JoinParams>;
  error: string | null;
  busy: boolean;
  onJoin(p: JoinParams & { alias: string }): void;
}

export function Join(props: JoinProps) {
  const [passphrase, setPassphrase] = useState(props.initial.passphrase ?? '');
  const [env, setEnv] = useState<EnvName>(props.initial.env ?? 'quiet');
  const [profile, setProfile] = useState<ProfileName>(props.initial.profile ?? ENVS[props.initial.env ?? 'quiet'].defaultProfile);
  const [alias, setAlias] = useState('');
  return (
    <section class="panel">
      <h1>BirdSong</h1>
      <p>Your phone will listen for, relay and sing hidden messages as birdsong.</p>
      <label>Passphrase
        <input type="text" value={passphrase} autocomplete="off" onInput={(e) => setPassphrase(e.currentTarget.value)} />
      </label>
      <label>Environment
        <select value={env} onChange={(e) => setEnv(e.currentTarget.value as EnvName)}>
          {ENV_NAMES.map((n) => <option value={n}>{ENVS[n].label}</option>)}
        </select>
      </label>
      <label>Profile
        <select value={profile} onChange={(e) => setProfile(e.currentTarget.value as ProfileName)}>
          {PROFILE_NAMES.map((n) => <option value={n}>{n}</option>)}
        </select>
      </label>
      <label>Alias
        <input type="text" value={alias} maxLength={MAX_ALIAS_CHARS} onInput={(e) => setAlias(e.currentTarget.value)} />
      </label>
      <button class="big" disabled={props.busy || !passphrase} onClick={() => props.onJoin({ passphrase, env, profile, alias })}>
        Join the flock
      </button>
      {props.error && <p class="error">{props.error}</p>}
    </section>
  );
}
