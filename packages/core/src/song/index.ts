import type { EnvName, ProfileName } from '../envs.ts';

export interface SongOptions {
  passphrase: string;
  env: EnvName;
  profile: ProfileName;
  sampleRate: number;
}
export interface DecodedSongMessage { msgId: number; text: string; alias: string }

export function renderMessageSong(_opts: SongOptions & { text: string; alias: string; species: number; sender: number }): Promise<Float32Array> {
  throw new Error('not implemented: plan 006');
}
export function decodeSong(_pcm: Float32Array, _opts: SongOptions): Promise<DecodedSongMessage[]> {
  throw new Error('not implemented: plan 006');
}
