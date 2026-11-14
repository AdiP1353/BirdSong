import { describe, expect, it } from 'vitest';
import { createTxQueue } from './txQueue.ts';

describe('txQueue', () => {
  it('is first in, first out', () => {
    const q = createTxQueue();
    q.push({ msgId: 1, kind: 'burst' });
    q.push({ msgId: 2, kind: 'trickle' });
    expect(q.length).toBe(2);
    expect(q.shift()).toEqual({ msgId: 1, kind: 'burst' });
    expect(q.shift()).toEqual({ msgId: 2, kind: 'trickle' });
    expect(q.shift()).toBeUndefined();
    expect(q.length).toBe(0);
  });
  it('has() reports queued messages', () => {
    const q = createTxQueue();
    expect(q.has(1)).toBe(false);
    q.push({ msgId: 1, kind: 'burst' });
    expect(q.has(1)).toBe(true);
    expect(q.has(2)).toBe(false);
    q.shift();
    expect(q.has(1)).toBe(false);
  });
  it('removeMsg drops every item of that message only', () => {
    const q = createTxQueue();
    q.push({ msgId: 1, kind: 'burst' });
    q.push({ msgId: 2, kind: 'burst' });
    q.push({ msgId: 1, kind: 'trickle' });
    q.removeMsg(1);
    expect(q.length).toBe(1);
    expect(q.has(1)).toBe(false);
    expect(q.shift()).toEqual({ msgId: 2, kind: 'burst' });
  });
});
