import { describe, expect, it } from 'vitest';
import { buildJoinUrl, parseJoin } from './join.ts';

describe('join links', () => {
  it('round trips', () => {
    const p = { passphrase: 'test', env: 'jungle', profile: 'stealth' } as const;
    const url = buildJoinUrl('https://x.github.io/birdsong/', p);
    expect(url.startsWith('https://x.github.io/birdsong/#')).toBe(true);
    expect(parseJoin(url.slice(url.indexOf('#')))).toEqual(p);
  });
  it('handles spaces, & and #', () => {
    const p = { passphrase: 'a b&c#d=e', env: 'coast', profile: 'fast' } as const;
    const url = buildJoinUrl('https://h/', p);
    expect(parseJoin(new URL(url).hash)).toEqual(p);
  });
  it('drops bad values', () => {
    expect(parseJoin('#k=x&env=moon&p=slow')).toEqual({ passphrase: 'x' });
    expect(parseJoin('')).toEqual({});
  });
});
