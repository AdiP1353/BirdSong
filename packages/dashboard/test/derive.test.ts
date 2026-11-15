import { describe, expect, it } from 'vitest';
import type { TelemetryEvent, TopologyView } from '@birdsong/core';
import { singingNow, toggleLinkText, trailFor } from '../src/derive.ts';

const heard = (node: number, from: number, t: number, msgId = 7): TelemetryEvent =>
  ({ type: 'heard', node, from, msgId, seed: 0, hop: 0, k: 2, sync: 1, t });

describe('travelling glow helpers', () => {
  it('singingNow lists birds in the middle of a frame', () => {
    const ev: TelemetryEvent[] = [
      { type: 'singing', node: 1, msgId: 7, seed: 0, hop: 0, k: 2, durationMs: 3000, t: 1000 },
      { type: 'singing', node: 2, msgId: 7, seed: 1, hop: 1, k: 2, durationMs: 3000, t: 1500 },
      { type: 'sang', node: 2, msgId: 7, seed: 1, hop: 1, k: 2, airHex: '', durationMs: 3000, t: 2000 },
    ];
    expect(singingNow(ev, 2500).map((s) => s.node)).toEqual([1]);
    expect(singingNow(ev, 4100)).toEqual([]);
  });

  it('trailFor keeps the first bird each bird heard the message from, and the hop counts', () => {
    const ev: TelemetryEvent[] = [
      { type: 'decoded', node: 0, msgId: 7, hops: 0, text: 'x', alias: '', t: 1 },
      heard(1, 0, 10), heard(1, 0, 20), heard(2, 1, 30), heard(0, 1, 31), heard(2, 0, 40), heard(3, 2, 50, 8),
      { type: 'decoded', node: 2, msgId: 7, hops: 2, text: 'x', alias: '', t: 60 },
    ];
    const t = trailFor(ev, 7);
    expect(t.edges.map((e) => [e.from, e.to])).toEqual([[0, 1], [1, 2]]);
    expect([...t.hops]).toEqual([[0, 0], [2, 2]]);
    expect(trailFor(ev, null).edges).toEqual([]);
  });
});

describe('drawing links', () => {
  const view = (text: string, links: [number, number][]): TopologyView => ({ manual: true, text, links });
  it('adds a two-way link, removes one, and refuses to remove the last', () => {
    const v = view('0-1', [[0, 1], [1, 0]]);
    expect(toggleLinkText(v, 1, 2, [])).toBe('0-1\n1-2');
    expect(toggleLinkText(view('0-1\n1-2', [[0, 1], [1, 0], [1, 2], [2, 1]]), 2, 1, [])).toBe('0-1');
    expect(toggleLinkText(v, 0, 1, [])).toBeNull();
  });
  it('in distance mode starts from the links seen lately', () => {
    expect(toggleLinkText({ manual: false, text: '', links: [] }, 0, 3, [[0, 1]])).toBe('0-1\n0-3');
    expect(toggleLinkText(null, 4, 5, [])).toBe('4-5');
  });
});
