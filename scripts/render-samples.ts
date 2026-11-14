// Dev script: node scripts/render-samples.ts  -> writes listening samples into samples/
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AMBIENT_LEVEL, ENV_NAMES, PROFILE_NAMES, encodeWav, renderAmbient, renderMessageSong } from '../packages/core/src/index.ts';

const outDir = fileURLToPath(new URL('../samples/', import.meta.url));
mkdirSync(outDir, { recursive: true });

function save(name: string, pcm: Float32Array, sampleRate: number): void {
  writeFileSync(outDir + name, encodeWav(pcm, sampleRate));
  console.log(`wrote samples/${name}`);
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, x.length));
}

for (const env of ['jungle', 'coast', 'city'] as const) {
  save(`ambient-${env}.wav`, renderAmbient(env, 10, 48_000, 1), 48_000);
}

const SR = 24_000;
const base = { passphrase: 'demo-flock', text: 'Meet at the old bridge at 6', alias: 'robin', species: 0, sender: 1, sampleRate: SR };
for (const env of ENV_NAMES) {
  for (const profile of PROFILE_NAMES) {
    save(`song-${env}-${profile}.wav`, await renderMessageSong({ ...base, env, profile }), SR);
  }
}

const song = await renderMessageSong({ ...base, env: 'jungle', profile: 'stealth' });
const bed = renderAmbient('jungle', song.length / SR + 1, SR, 1).subarray(0, song.length);
const gain = (AMBIENT_LEVEL.jungle * rms(song)) / rms(bed);
const mixed = new Float32Array(song.length);
for (let i = 0; i < mixed.length; i++) mixed[i] = song[i]! + gain * bed[i]!;
save('song-jungle-stealth+ambient.wav', mixed, SR);
