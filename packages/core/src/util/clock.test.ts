import { describe, expect, it } from 'vitest';
import { createVirtualClock } from './clock.ts';

describe('virtual clock', () => {
  it('fires timers in due-time order', () => {
    const c = createVirtualClock();
    const out: number[] = [];
    c.setTimeout(() => out.push(2), 20);
    c.setTimeout(() => out.push(1), 10);
    c.setTimeout(() => out.push(3), 20);
    c.advance(30);
    expect(out).toEqual([1, 2, 3]);
    expect(c.now()).toBe(30);
  });
  it('fires timers created during the advance', () => {
    const c = createVirtualClock();
    const out: string[] = [];
    c.setTimeout(() => {
      out.push('a');
      c.setTimeout(() => out.push('b'), 5);
    }, 10);
    c.advance(20);
    expect(out).toEqual(['a', 'b']);
  });
  it('clearTimeout prevents firing', () => {
    const c = createVirtualClock();
    let fired = false;
    const id = c.setTimeout(() => (fired = true), 10);
    c.clearTimeout(id);
    c.advance(100);
    expect(fired).toBe(false);
  });
  it('now() inside a callback equals its due time', () => {
    const c = createVirtualClock(100);
    let seen = -1;
    c.setTimeout(() => (seen = c.now()), 25);
    c.advance(50);
    expect(seen).toBe(125);
    expect(c.now()).toBe(150);
  });
});
