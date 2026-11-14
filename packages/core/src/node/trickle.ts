import type { Clock, TimerId } from '../types.ts';

export interface TrickleParams {
  TRICKLE_IMIN_MS: number;
  TRICKLE_IMAX_MS: number;
  TRICKLE_K: number;
}

export interface Trickle {
  start(): void;
  stop(): void;
  /** Count one consistent transmission heard in the current interval. */
  heard(): void;
}

/**
 * Trickle timer. Intervals double from IMIN up to IMAX. In each interval a
 * single fire is scheduled at a random time in its second half, and it is
 * suppressed if at least TRICKLE_K transmissions were heard before it.
 */
export function createTrickle(
  clock: Clock,
  rng: () => number,
  params: TrickleParams,
  onFire: () => void,
): Trickle {
  let running = false;
  let interval = params.TRICKLE_IMIN_MS;
  let count = 0;
  let fireTimer: TimerId | null = null;
  let endTimer: TimerId | null = null;

  function clearTimers(): void {
    if (fireTimer !== null) clock.clearTimeout(fireTimer);
    if (endTimer !== null) clock.clearTimeout(endTimer);
    fireTimer = null;
    endTimer = null;
  }

  function beginInterval(): void {
    count = 0;
    const t = interval / 2 + (rng() * interval) / 2;
    fireTimer = clock.setTimeout(() => {
      fireTimer = null;
      if (running && count < params.TRICKLE_K) onFire();
    }, t);
    endTimer = clock.setTimeout(() => {
      endTimer = null;
      if (!running) return;
      interval = Math.min(interval * 2, params.TRICKLE_IMAX_MS);
      beginInterval();
    }, interval);
  }

  return {
    start() {
      if (running) return;
      running = true;
      interval = params.TRICKLE_IMIN_MS;
      beginInterval();
    },
    stop() {
      running = false;
      clearTimers();
    },
    heard() {
      count++;
    },
  };
}
