import { describe, expect, it } from 'vitest';
import { DEFAULT_NODE_CONFIG } from '@birdsong/core';
import type { TelemetryEvent } from '@birdsong/core';
import { createHubState } from './state.ts';

const hello = (node: number): TelemetryEvent => ({
  type: 'hello', node, species: node % 4, kind: 'sim', config: { ...DEFAULT_NODE_CONFIG }, t: 1,
});

describe('hub state', () => {
  it('creates nodes from hello', () => {
    const s = createHubState();
    s.apply(hello(2), 100);
    expect(s.snapshot()).toMatchObject([{ node: 2, kind: 'sim', online: true, lastSeenAt: 100 }]);
  });

  it('infers a browser node from heard-from-unknown', () => {
    const s = createHubState();
    s.apply(hello(0), 1);
    s.apply({ type: 'heard', node: 0, from: 130, msgId: 1, seed: 1, hop: 1, k: 3, sync: 0.5, t: 2 }, 2);
    const n = s.snapshot().find((x) => x.node === 130)!;
    expect(n.kind).toBe('browser');
    expect(n.species).toBe(130 % 4);
    expect(n.online).toBe(true);
    expect(n.config).toEqual(DEFAULT_NODE_CONFIG);
  });

  it('a phone that says hello is its own node, with its name, and keeps it after it sends', () => {
    const s = createHubState();
    s.apply(hello(0), 1);
    s.apply({ type: 'hello', node: 200, species: 2, kind: 'browser', config: { ...DEFAULT_NODE_CONFIG }, t: 2, alias: 'Ada' }, 2);
    s.apply({ type: 'heard', node: 0, from: 200, msgId: 1, seed: 1, hop: 0, k: 3, sync: 0.5, t: 3 }, 3);
    expect(s.snapshot()).toMatchObject([{ node: 0 }, { node: 200, kind: 'browser', species: 2, alias: 'Ada', online: true }]);
    expect(s.aliasOf(200)).toBe('Ada');
    s.apply({ type: 'decoded', node: 200, msgId: 1, hops: 0, text: 'hi', alias: '', t: 4 }, 4);
    expect(s.aliasOf(200)).toBe('Ada');
  });

  it('marks offline', () => {
    const s = createHubState();
    s.apply(hello(0), 1);
    s.markOffline(0, 5);
    expect(s.snapshot()[0]!.online).toBe(false);
  });

  it('keeps a ring of 500 events', () => {
    const s = createHubState();
    s.apply(hello(0), 1);
    for (let i = 0; i < 700; i++) s.apply({ type: 'expired', node: 0, msgId: i, t: i }, i);
    expect(s.recent()).toHaveLength(500);
    expect((s.recent().at(-1) as { msgId: number }).msgId).toBe(699);
  });

  it('load replaces all state', () => {
    const s = createHubState();
    s.apply(hello(0), 1);
    s.apply({ type: 'decoded', node: 0, msgId: 1, hops: 0, text: 'hi', alias: 'wren', t: 1 }, 1);
    const other = createHubState();
    other.apply(hello(7), 3);
    s.load(other.snapshot(), other.recent());
    expect(s.snapshot().map((n) => n.node)).toEqual([7]);
    expect(s.recent()).toHaveLength(1);
    expect(s.aliasOf(0)).toBeNull();
  });

  it('aliasOf uses hops === 0 decoded events only', () => {
    const s = createHubState();
    s.apply(hello(0), 1);
    expect(s.aliasOf(0)).toBeNull();
    s.apply({ type: 'decoded', node: 0, msgId: 1, hops: 2, text: 'x', alias: 'other', t: 1 }, 1);
    expect(s.aliasOf(0)).toBeNull();
    s.apply({ type: 'decoded', node: 0, msgId: 2, hops: 0, text: 'y', alias: 'wren', t: 2 }, 2);
    expect(s.aliasOf(0)).toBe('wren');
  });

  it('config event updates the node config', () => {
    const s = createHubState();
    s.apply(hello(0), 1);
    s.apply({ type: 'config', node: 0, config: { ...DEFAULT_NODE_CONFIG, muted: true }, t: 2 }, 2);
    expect(s.snapshot()[0]!.config.muted).toBe(true);
  });
});
