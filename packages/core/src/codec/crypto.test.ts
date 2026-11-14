import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../util/prng.ts';
import { deriveChannel, msgIdOf, openMessage, sealMessage } from './crypto.ts';
import { splitBlocks } from './fountain.ts';

const long = 'meet at the old bridge after sunset, bring the maps and a flask of tea, '.repeat(3).slice(0, 140);

describe('crypto', () => {
  it('round trips', async () => {
    const ch = await deriveChannel('secret');
    const env = await sealMessage(ch, long, 'robin');
    expect(await openMessage(ch, env)).toEqual({ alias: 'robin', text: long });
    expect(await msgIdOf(env)).toBeGreaterThanOrEqual(0);
  });
  it('wrong passphrase fails', async () => {
    const a = await deriveChannel('one');
    const b = await deriveChannel('two');
    expect(await openMessage(b, await sealMessage(a, 'hello', 'x'))).toBeNull();
  });
  it('any bit flip fails', async () => {
    const ch = await deriveChannel('secret');
    const env = await sealMessage(ch, 'hello world', 'robin');
    for (let i = 0; i < env.length; i++) {
      const bad = env.slice();
      bad[i] = bad[i]! ^ 1;
      expect(await openMessage(ch, bad)).toBeNull();
    }
  });
  it('deterministic netTag', async () => {
    expect((await deriveChannel('p')).netTag).toBe((await deriveChannel('p')).netTag);
  });
  it('length limits', async () => {
    const ch = await deriveChannel('secret');
    await expect(sealMessage(ch, 'a'.repeat(141), 'x')).rejects.toThrow(RangeError);
    await expect(sealMessage(ch, '', 'x')).rejects.toThrow(RangeError);
    await expect(sealMessage(ch, 'hi', 'x\ny')).rejects.toThrow(RangeError);
    await expect(sealMessage(ch, 'hi', 'abcdefghi')).rejects.toThrow(RangeError);
  });
  it('140 random printable chars fit', async () => {
    const ch = await deriveChannel('secret');
    const r = mulberry32(5);
    const text = Array.from({ length: 140 }, () => String.fromCharCode(33 + Math.floor(r() * 94))).join('');
    const env = await sealMessage(ch, text, 'robin');
    expect(splitBlocks(env).length).toBeLessThanOrEqual(15);
    expect((await openMessage(ch, env))?.text).toBe(text);
  });
  it('random nonce', async () => {
    const ch = await deriveChannel('secret');
    const a = await sealMessage(ch, 'same', 'me');
    const b = await sealMessage(ch, 'same', 'me');
    expect(a).not.toEqual(b);
    expect((await openMessage(ch, a))?.text).toBe('same');
    expect((await openMessage(ch, b))?.text).toBe('same');
  });
});
