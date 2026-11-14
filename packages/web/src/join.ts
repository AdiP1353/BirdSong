import { ENV_NAMES, PROFILE_NAMES } from '@birdsong/core';
import type { EnvName, ProfileName } from '@birdsong/core';

export interface JoinParams { passphrase: string; env: EnvName; profile: ProfileName }

/** Tolerant parser for the link fragment. Bad values are dropped. */
export function parseJoin(hash: string): Partial<JoinParams> {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const out: Partial<JoinParams> = {};
  const k = q.get('k');
  if (k) out.passphrase = k;
  const env = q.get('env');
  if (env && (ENV_NAMES as readonly string[]).includes(env)) out.env = env as EnvName;
  const p = q.get('p');
  if (p && (PROFILE_NAMES as readonly string[]).includes(p)) out.profile = p as ProfileName;
  return out;
}

export function buildJoinUrl(base: string, p: JoinParams): string {
  const q = new URLSearchParams({ k: p.passphrase, env: p.env, p: p.profile });
  return `${base.split('#')[0]}#${q.toString()}`;
}
