import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInteractionLog } from '../src/server/interactionLog.ts';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'bs-log-'));

describe('interaction log', () => {
  it('memory only: since and limit', () => {
    const log = createInteractionLog();
    for (let i = 0; i < 3; i++) log.append('offline', { node: i });
    expect(log.since(0).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(log.since(2).map((e) => e.seq)).toEqual([3]);
    expect(log.since(0, 2).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('caps the in-memory ring', () => {
    const log = createInteractionLog({ keep: 3 });
    for (let i = 0; i < 10; i++) log.append('offline', { node: i });
    expect(log.since(0).map((e) => e.seq)).toEqual([8, 9, 10]);
  });

  it('writes NDJSON lines and creates the directory', () => {
    const file = join(tmp(), 'sub', 'log.ndjson');
    const log = createInteractionLog({ file, now: () => 1234 });
    log.append('offline', { node: 1 });
    log.append('offline', { node: 2 });
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ seq: 1, t: 1234, kind: 'offline', data: { node: 1 } });
    expect(JSON.parse(lines[1]!)).toEqual({ seq: 2, t: 1234, kind: 'offline', data: { node: 2 } });
  });

  it('rotates to <file>.1 when maxBytes would be exceeded', () => {
    const file = join(tmp(), 'log.ndjson');
    const log = createInteractionLog({ file, maxBytes: 300 });
    for (let i = 0; i < 10; i++) log.append('offline', { node: 1 });
    expect(existsSync(file + '.1')).toBe(true);
    expect(statSync(file).size).toBeLessThanOrEqual(300);
    for (const f of [file, file + '.1']) {
      for (const line of readFileSync(f, 'utf8').trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
