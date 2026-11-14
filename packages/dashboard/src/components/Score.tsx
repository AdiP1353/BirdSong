import { useEffect, useRef } from 'preact/hooks';
import { ENVS, envPitchesHz, envSignalRange, frameNotes, fromHex } from '@birdsong/core';
import type { EnvName, NodeSnapshot, TelemetryEvent } from '@birdsong/core';
import { speciesColor } from '../derive.ts';

const WINDOW_MS = 60_000;
const AHEAD_MS = 4_000;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi: number): string => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

type NoteList = ReturnType<typeof frameNotes>;

export function Score(props: { nodes: NodeSnapshot[]; events: TelemetryEvent[]; env: EnvName }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const cache = useRef(new Map<string, NoteList>());

  useEffect(() => {
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.max(1, Math.floor(c.clientWidth * dpr));
      const ch = Math.max(1, Math.floor(c.clientHeight * dpr));
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
      }
      const g = c.getContext('2d')!;
      const { nodes, events, env } = latest.current;
      const style = getComputedStyle(c);
      const fg = style.getPropertyValue('--fg').trim() || '#fff';
      const bg = style.getPropertyValue('--bg').trim() || '#000';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = c.clientWidth;
      const h = c.clientHeight;
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);

      const now = Date.now();
      const t0 = now - WINDOW_MS;
      const padL = 70;
      const padT = 40;
      const padB = 12;
      const { lowHz, highHz } = envSignalRange(env);
      const lo = Math.log(lowHz * 0.95);
      const hi = Math.log(highHz * 1.05);
      const xOf = (t: number): number => padL + ((t - t0) / (WINDOW_MS + AHEAD_MS)) * (w - padL - 8);
      const yOf = (hz: number): number => padT + (1 - (Math.log(hz) - lo) / (hi - lo)) * (h - padT - padB);

      g.font = '600 20px system-ui, sans-serif';
      g.fillStyle = fg;
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      g.fillText(`Score - ${ENVS[env].key}`, 12, 28);

      g.font = '16px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.lineWidth = 1;
      const pitches = envPitchesHz(env);
      pitches.forEach((hz, i) => {
        const y = yOf(hz);
        g.strokeStyle = fg;
        g.globalAlpha = 0.18;
        g.beginPath();
        g.moveTo(padL, y);
        g.lineTo(w - 8, y);
        g.stroke();
        g.globalAlpha = 0.85;
        g.fillText(noteName(ENVS[env].midi[i]!), 12, y);
      });
      g.globalAlpha = 1;

      const byNode = new Map(nodes.map((n) => [n.node, n]));
      g.lineWidth = 3;
      g.lineCap = 'round';
      const live = new Set<string>();
      for (const e of events) {
        if (e.type !== 'sang' || e.t < t0 - 5000) continue;
        const cfg = byNode.get(e.node)?.config;
        if (!cfg) continue;
        const key = `${e.node}:${e.t}:${e.seed}:${cfg.env}:${cfg.profile}`;
        live.add(key);
        let notes = cache.current.get(key);
        if (!notes) {
          try {
            notes = frameNotes(fromHex(e.airHex), cfg.env, cfg.profile);
          } catch {
            notes = [];
          }
          cache.current.set(key, notes);
        }
        g.strokeStyle = speciesColor(byNode.get(e.node)!.species);
        for (const nt of notes) {
          const ts = e.t + nt.startMs;
          const te = ts + nt.durMs;
          if (te < t0 || ts > now + AHEAD_MS) continue;
          const xs = xOf(ts);
          const xe = Math.max(xs + 2, xOf(te));
          g.beginPath();
          g.moveTo(xs, yOf(nt.hzStart));
          g.lineTo((xs + xe) / 2, yOf(nt.hzMid));
          g.lineTo(xe, yOf(nt.hzEnd));
          g.stroke();
        }
      }
      for (const k of cache.current.keys()) if (!live.has(k)) cache.current.delete(k);

      const xn = xOf(now);
      g.strokeStyle = fg;
      g.globalAlpha = 0.6;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(xn, padT);
      g.lineTo(xn, h - padB);
      g.stroke();
      g.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas class="panel score" ref={canvas} />;
}
