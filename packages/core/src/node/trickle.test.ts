import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../util/clock.ts';
import { mulberry32 } from '../util/prng.ts';
import { NODE_PARAMS } from './params.ts';
import { createTrickle } from './trickle.ts';

function setup(seed = 7) {
  const clock = createVirtualClock(0);
  const fires: number[] = [];
  const tr = createTrickle(clock, mulberry32(seed), NODE_PARAMS, () => fires.push(clock.now() / 1000));
  return { clock, fires, tr };
}

describe('trickle', () => {
  it('fires once in the second half of intervals that double up to the maximum', () => {
    const { clock, fires, tr } = setup();
    tr.start();
    clock.advance(200_000);
    // intervals: [0,10) [10,30) [30,70) [70,130) [130,190) [190,250)
    const expected: Array<[number, number]> = [[5, 10], [20, 30], [50, 70], [100, 130], [160, 190]];
    expect(fires.length).toBe(expected.length);
    expected.forEach(([lo, hi], i) => {
      expect(fires[i]!).toBeGreaterThanOrEqual(lo);
      expect(fires[i]!).toBeLessThan(hi);
    });
  });

  it('is suppressed by two heard() calls early in an interval', () => {
    const { clock, fires, tr } = setup();
    tr.start();
    clock.advance(1000);
    tr.heard();
    tr.heard();
    clock.advance(9500); // end of interval 1 (10 s)
    expect(fires.length).toBe(0);
    // the next interval starts with a fresh counter
    clock.advance(20_000);
    expect(fires.length).toBe(1);
    expect(fires[0]!).toBeGreaterThanOrEqual(20);
    expect(fires[0]!).toBeLessThan(30);
  });

  it('one heard() call does not suppress', () => {
    const { clock, fires, tr } = setup();
    tr.start();
    tr.heard();
    clock.advance(10_000);
    expect(fires.length).toBe(1);
  });

  it('stop() prevents further fires', () => {
    const { clock, fires, tr } = setup();
    tr.start();
    clock.advance(12_000);
    expect(fires.length).toBe(1);
    tr.stop();
    clock.advance(300_000);
    expect(fires.length).toBe(1);
  });
});
