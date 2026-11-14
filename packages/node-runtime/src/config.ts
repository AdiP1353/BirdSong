import { parseArgs } from 'node:util';
import { ENVS, ENV_NAMES, PROFILE_NAMES } from '@birdsong/core';
import type { EnvName, ProfileName } from '@birdsong/core';

export interface RuntimeConfig {
  help: boolean;
  id: number;
  key: string;
  alias: string;
  env: EnvName;
  profile: ProfileName;
  volume: number;
  audio: 'pulse' | 'ether';
  ether: string;
  x: number;
  y: number;
  observatory: string | null;
  port: number;
  neighbors: number[] | null;
  camouflage: boolean;
}

export const USAGE = `birdsong node runtime

Usage: node packages/node-runtime/src/main.ts --key <passphrase> [options]

Options (each also reads the environment variable shown):
  --id <0..255>          BIRDSONG_ID           node id (default: random)
  --key <text>           BIRDSONG_KEY          channel passphrase (required)
  --alias <text>         BIRDSONG_ALIAS        display name (default: bird<id>)
  --env <name>           BIRDSONG_ENV          ${ENV_NAMES.join(' | ')} (default: quiet)
  --profile <name>       BIRDSONG_PROFILE      ${PROFILE_NAMES.join(' | ')} (default: the env's default)
  --volume <0..1>        BIRDSONG_VOLUME       output gain (default: 0.8)
  --audio <pulse|ether>  BIRDSONG_AUDIO        real speaker/mic or simulated air (default: pulse)
  --ether <url>          BIRDSONG_ETHER        ether service (default: ws://localhost:7080)
  --x <n> --y <n>        BIRDSONG_X, BIRDSONG_Y  position in the ether (default: 0)
  --observatory <url>    BIRDSONG_OBSERVATORY  dashboard hub base URL, e.g. ws://hub:7070
  --port <n>             BIRDSONG_PORT         HTTP/UI port (default: 8080)
  --neighbors <ids>      BIRDSONG_NEIGHBORS    comma-separated sender ids to accept
  --camouflage           BIRDSONG_CAMOUFLAGE   play the ambient bed (true|false)
  --help                 print this text
`;

function num(name: string, v: string, min: number, max: number, int: boolean): number {
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    throw new Error(`${name} must be ${int ? 'an integer' : 'a number'} between ${min} and ${max}, got "${v}"`);
  }
  return n;
}

export function parseConfig(argv: string[], env: Record<string, string | undefined>): RuntimeConfig {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      help: { type: 'boolean' },
      id: { type: 'string' },
      key: { type: 'string' },
      alias: { type: 'string' },
      env: { type: 'string' },
      profile: { type: 'string' },
      volume: { type: 'string' },
      audio: { type: 'string' },
      ether: { type: 'string' },
      x: { type: 'string' },
      y: { type: 'string' },
      observatory: { type: 'string' },
      port: { type: 'string' },
      neighbors: { type: 'string' },
      camouflage: { type: 'boolean' },
    },
  });
  const pick = (flag: string, envName: string): string | undefined => {
    const v = (values as Record<string, string | boolean | undefined>)[flag];
    if (typeof v === 'string') return v;
    const e = env[envName];
    return e !== undefined && e !== '' ? e : undefined;
  };
  const base = { help: true } as RuntimeConfig;
  if (values.help) return base;

  const key = pick('key', 'BIRDSONG_KEY');
  if (!key) throw new Error('--key (or BIRDSONG_KEY) is required');
  const idS = pick('id', 'BIRDSONG_ID');
  const id = idS === undefined ? Math.floor(Math.random() * 256) : num('--id', idS, 0, 255, true);
  const envName = (pick('env', 'BIRDSONG_ENV') ?? 'quiet') as EnvName;
  if (!ENV_NAMES.includes(envName)) throw new Error(`--env must be one of ${ENV_NAMES.join(', ')}, got "${envName}"`);
  const profile = (pick('profile', 'BIRDSONG_PROFILE') ?? ENVS[envName].defaultProfile) as ProfileName;
  if (!PROFILE_NAMES.includes(profile)) throw new Error(`--profile must be one of ${PROFILE_NAMES.join(', ')}, got "${profile}"`);
  const audio = pick('audio', 'BIRDSONG_AUDIO') ?? 'pulse';
  if (audio !== 'pulse' && audio !== 'ether') throw new Error(`--audio must be pulse or ether, got "${audio}"`);
  const nb = pick('neighbors', 'BIRDSONG_NEIGHBORS');
  const neighbors = nb === undefined || nb.trim() === ''
    ? null
    : nb.split(',').map((s) => num('--neighbors', s.trim(), 0, 255, true));
  let camouflage: boolean;
  if (values.camouflage) camouflage = true;
  else {
    const c = env['BIRDSONG_CAMOUFLAGE'];
    camouflage = c === 'true' || c === '1';
  }
  return {
    help: false,
    id,
    key,
    alias: pick('alias', 'BIRDSONG_ALIAS') ?? `bird${id}`,
    env: envName,
    profile,
    volume: num('--volume', pick('volume', 'BIRDSONG_VOLUME') ?? '0.8', 0, 1, false),
    audio,
    ether: pick('ether', 'BIRDSONG_ETHER') ?? 'ws://localhost:7080',
    x: num('--x', pick('x', 'BIRDSONG_X') ?? '0', -1e6, 1e6, false),
    y: num('--y', pick('y', 'BIRDSONG_Y') ?? '0', -1e6, 1e6, false),
    observatory: pick('observatory', 'BIRDSONG_OBSERVATORY') ?? null,
    port: num('--port', pick('port', 'BIRDSONG_PORT') ?? '8080', 0, 65535, true),
    neighbors,
    camouflage,
  };
}
