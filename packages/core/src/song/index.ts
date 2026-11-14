import type { EnvName, ProfileName } from '../envs.ts';

export interface SongOptions {
  passphrase: string;
  env: EnvName;
  profile: ProfileName;
  sampleRate: number;
}
export interface DecodedSongMessage { msgId: number; text: string; alias: string }

export { renderMessageSong } from './song.ts';
export { decodeSong } from './decode.ts';
