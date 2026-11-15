import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Command, TelemetryEvent } from '@birdsong/core';

/**
 * 'event' = telemetry from a node, 'command' = sent from a dashboard tab, 'offline' = a node's socket closed,
 * 'topology' = the ether's topology was changed from the dashboard.
 */
export type LogKind = 'event' | 'command' | 'offline' | 'topology' | 'disabled';
export interface LogEntry {
  seq: number;
  t: number;
  kind: LogKind;
  data: TelemetryEvent | Command | { node: number } | { manual: boolean; text: string } | { disabled: boolean };
}
export interface InteractionLogOptions {
  /** NDJSON file to append to; null or absent = memory only. */
  file?: string | null;
  /** Rotate to `<file>.1` before a write would exceed this size. Default 10 MiB. */
  maxBytes?: number;
  /** Entries kept in memory for GET /api/log. Default 2000. */
  keep?: number;
  now?: () => number;
}
export interface InteractionLog {
  append(kind: LogKind, data: LogEntry['data']): LogEntry;
  /** Entries with seq > after, oldest first, at most `limit` (default 500). */
  since(after: number, limit?: number): LogEntry[];
  close(): void;
}

export function createInteractionLog(opts: InteractionLogOptions = {}): InteractionLog {
  const file = opts.file ?? null;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const keep = opts.keep ?? 2000;
  const now = opts.now ?? Date.now;
  const ring: LogEntry[] = [];
  let seq = 0;
  let size = 0;
  let fileOk = file !== null;
  if (file !== null) {
    mkdirSync(dirname(file), { recursive: true });
    try { size = statSync(file).size; } catch { size = 0; }
  }
  return {
    append(kind, data) {
      const entry: LogEntry = { seq: ++seq, t: now(), kind, data };
      ring.push(entry);
      if (ring.length > keep) ring.splice(0, ring.length - keep);
      if (fileOk && file !== null) {
        const line = JSON.stringify(entry) + '\n';
        const bytes = Buffer.byteLength(line);
        try {
          if (size > 0 && size + bytes > maxBytes) {
            renameSync(file, file + '.1');
            size = 0;
          }
          appendFileSync(file, line);
          size += bytes;
        } catch (err) {
          fileOk = false;
          console.error(`interaction log disabled: ${(err as Error).message}`);
        }
      }
      return entry;
    },
    since(after, limit = 500) {
      const out: LogEntry[] = [];
      for (const e of ring) {
        if (e.seq <= after) continue;
        out.push(e);
        if (out.length >= limit) break;
      }
      return out;
    },
    close() {},
  };
}
