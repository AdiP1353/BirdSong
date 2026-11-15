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

/**
 * The first screen. From the dashboard's QR code the flock settings are already filled in, so it is one tap: turn on
 * the microphone and the phone becomes a bird. Without them (a bare link), the settings open for typing.
 */
export function Join(props: JoinProps) {
  const [passphrase, setPassphrase] = useState(props.initial.passphrase ?? '');
  const [env, setEnv] = useState<EnvName>(props.initial.env ?? 'quiet');
  const [profile, setProfile] = useState<ProfileName>(props.initial.profile ?? ENVS[props.initial.env ?? 'quiet'].defaultProfile);
  const [alias, setAlias] = useState('');
  const fromLink = props.initial.passphrase !== undefined;
  const secure = typeof window === 'undefined' || window.isSecureContext;
  return (
    <section class="panel">
      <h1>BirdSong</h1>
      <p>Your phone becomes a bird in the flock. It listens through the microphone for messages hidden in birdsong, sings them on, and you can speak or type your own.</p>
      <label>Your name (optional)
        <input type="text" value={alias} maxLength={MAX_ALIAS_CHARS} placeholder="Ada" autocomplete="off" onInput={(e) => setAlias(e.currentTarget.value)} />
      </label>
      <details class="flock-settings" open={!fromLink}>
        <summary>{fromLink ? `Flock: ${ENVS[env].label} · ${profile}` : 'Flock settings'}</summary>
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
      </details>
      <button class="big" disabled={props.busy || !passphrase || !secure} onClick={() => props.onJoin({ passphrase, env, profile, alias })}>
        🎤 Turn on the microphone
      </button>
      {!secure && (
        <p class="error">This page is not on HTTPS, so the browser will not lend it the microphone. Scan the QR code on the big screen again (it opens an https:// address).</p>
      )}
      {props.error && <p class="error">{props.error}</p>}
    </section>
  );
}
