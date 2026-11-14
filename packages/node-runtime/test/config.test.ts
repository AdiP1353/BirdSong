import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';

describe('parseConfig', () => {
  it('applies defaults', () => {
    const c = parseConfig(['--key', 'k'], {});
    expect(c).toMatchObject({
      key: 'k', env: 'quiet', profile: 'fast', volume: 0.8, audio: 'pulse', ether: 'ws://localhost:7080',
      x: 0, y: 0, observatory: null, port: 8080, neighbors: null, camouflage: false,
    });
    expect(c.id).toBeGreaterThanOrEqual(0);
    expect(c.id).toBeLessThanOrEqual(255);
    expect(c.alias).toBe(`bird${c.id}`);
  });
  it('uses the env default profile', () => {
    expect(parseConfig(['--key', 'k', '--env', 'jungle'], {}).profile).toBe('stealth');
  });
  it('reads env vars and flags override them', () => {
    const env = { BIRDSONG_KEY: 'envkey', BIRDSONG_ID: '5', BIRDSONG_PORT: '9000', BIRDSONG_NEIGHBORS: '1,2', BIRDSONG_CAMOUFLAGE: 'true' };
    const a = parseConfig([], env);
    expect(a).toMatchObject({ key: 'envkey', id: 5, port: 9000, neighbors: [1, 2], camouflage: true });
    const b = parseConfig(['--key', 'flag', '--id', '7', '--port', '1234'], env);
    expect(b).toMatchObject({ key: 'flag', id: 7, port: 1234 });
  });
  it('rejects an invalid env', () => {
    expect(() => parseConfig(['--key', 'k', '--env', 'moon'], {})).toThrow(/env/);
  });
  it('requires a key', () => {
    expect(() => parseConfig([], {})).toThrow(/key/);
  });
  it('--help does not need a key', () => {
    expect(parseConfig(['--help'], {}).help).toBe(true);
  });
});
