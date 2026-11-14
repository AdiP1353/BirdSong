import { describe, expect, it } from 'vitest';
import { PROFILES, PROFILE_NAMES } from '../envs.ts';
import type { ProfileName } from '../envs.ts';
import { addNoise } from '../modem/channelSim.ts';
import { frameAirtimeMs } from '../timing.ts';
import { mulberry32 } from '../util/prng.ts';
import { decodeWav, encodeWav } from '../util/wav.ts';
import { decodeSong, renderMessageSong } from './index.ts';

const SR = 16_000;
const PASS = 'test-flock';

function opts(profile: ProfileName, extra: Partial<{ sampleRate: number; env: 'coast' | 'quiet'; passphrase: string }> = {}) {
  return { passphrase: PASS, env: 'coast' as 'coast' | 'quiet', profile, sampleRate: SR, ...extra };
}

async function song(profile: ProfileName, text: string, alias = 'robin', o = opts(profile)) {
  return renderMessageSong({ ...o, text, alias, species: 1, sender: 7 });
}

describe('song', () => {
  for (const profile of PROFILE_NAMES) {
    it(`round trips (${profile})`, async () => {
      const pcm = await song(profile, 'Meet at the old bridge at 6');
      const got = await decodeSong(pcm, opts(profile));
      expect(got.length).toBe(1);
      expect(got[0]!.text).toBe('Meet at the old bridge at 6');
      expect(got[0]!.alias).toBe('robin');
    });
  }

  it('two songs concatenated give two messages in order', async () => {
    const a = await song('fast', 'first message');
    const b = await song('fast', 'second message', 'wren');
    const both = new Float32Array(a.length + b.length);
    both.set(a);
    both.set(b, a.length);
    const got = await decodeSong(both, opts('fast'));
    expect(got.map((m) => m.text)).toEqual(['first message', 'second message']);
  });

  it('survives losing any two frames (k = 2)', async () => {
    const profile: ProfileName = 'fast';
    const text = 'x'.repeat(30);
    const pcm = await song(profile, text);
    const frameLen = Math.round((frameAirtimeMs(PROFILES[profile]) / 1000) * SR);
    const lead = Math.round(0.5 * SR);
    const gap = Math.round(0.4 * SR);
    const nFrames = Math.round((pcm.length - 2 * lead + gap) / (frameLen + gap));
    expect(nFrames).toBe(4);
    let pairs = 0;
    for (let i = 0; i < nFrames; i++) {
      for (let j = i + 1; j < nFrames; j++) {
        const x = pcm.slice();
        for (const f of [i, j]) {
          const start = lead + f * (frameLen + gap);
          x.fill(0, start - 100, Math.min(x.length, start + frameLen + 100));
        }
        const got = await decodeSong(x, opts(profile));
        expect(got.length, `lost frames ${i},${j}`).toBe(1);
        expect(got[0]!.text).toBe(text);
        pairs++;
      }
    }
    expect(pairs).toBe(6);
  });

  it('wrong passphrase gives nothing', async () => {
    const pcm = await song('fast', 'secret');
    expect(await decodeSong(pcm, opts('fast', { passphrase: 'other-flock' }))).toEqual([]);
  });

  it('decodes through 10 dB noise', async () => {
    const pcm = await song('fast', 'noisy hello');
    const noisy = addNoise(pcm, 10, mulberry32(5));
    const got = await decodeSong(noisy, opts('fast'));
    expect(got.length).toBe(1);
    expect(got[0]!.text).toBe('noisy hello');
  });

  it('survives a WAV round trip', async () => {
    const pcm = await song('fast', 'via wav');
    const wav = decodeWav(encodeWav(pcm, SR));
    expect(wav.sampleRate).toBe(SR);
    const got = await decodeSong(wav.pcm, opts('fast'));
    expect(got.map((m) => m.text)).toEqual(['via wav']);
  });

  it('works at 48000 Hz (quiet, fast)', async () => {
    const o = opts('fast', { env: 'quiet', sampleRate: 48_000 });
    const pcm = await song('fast', 'full rate', 'robin', o);
    const got = await decodeSong(pcm, o);
    expect(got.length).toBe(1);
    expect(got[0]!.text).toBe('full rate');
  });
});
