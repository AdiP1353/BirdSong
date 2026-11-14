import type { Clock, TimerId } from '../types.ts';

export function createRealClock(): Clock {
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  let next = 1;
  return {
    now: () => performance.now(),
    setTimeout(fn, ms) {
      const id = next++;
      handles.set(id, setTimeout(() => {
        handles.delete(id);
        fn();
      }, ms));
      return id;
    },
    clearTimeout(id) {
      const h = handles.get(id);
      if (h !== undefined) {
        clearTimeout(h);
        handles.delete(id);
      }
    },
  };
}

export interface VirtualClock extends Clock {
  advance(ms: number): void;
}

export function createVirtualClock(startMs?: number): VirtualClock {
  let nowMs = startMs ?? 0;
  let next = 1;
  const timers = new Map<TimerId, { due: number; order: number; fn: () => void }>();
  return {
    now: () => nowMs,
    setTimeout(fn, ms) {
      const id = next++;
      timers.set(id, { due: nowMs + Math.max(0, ms), order: id, fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = nowMs + ms;
      for (;;) {
        let best: [TimerId, { due: number; order: number; fn: () => void }] | null = null;
        for (const entry of timers) {
          const t = entry[1];
          if (t.due > end) continue;
          if (!best || t.due < best[1].due || (t.due === best[1].due && t.order < best[1].order)) best = entry;
        }
        if (!best) break;
        timers.delete(best[0]);
        nowMs = Math.max(nowMs, best[1].due);
        best[1].fn();
      }
      nowMs = end;
    },
  };
}
