/**
 * Manual topology for the simulated air: which node can hear which.
 *
 * Text format (whitespace, newlines or ';' separate tokens; '#' starts a comment):
 *   0-1,2   two-way links 0<->1 and 0<->2
 *   4>5     one-way link: 5 hears 4, 4 does not hear 5
 * Text with no links means "distance mode" (parseTopology returns null).
 */
export interface Topology {
  /** Directed links: [speaker, listener]. Sorted, no duplicates. */
  readonly links: ReadonlyArray<readonly [number, number]>;
}

/** Gain on every manual link (the same as two nodes 1 unit apart in distance mode). */
export const LINK_GAIN = 1;

function parseId(s: string, token: string): number {
  if (!/^\d{1,3}$/.test(s) || Number(s) > 255) {
    throw new Error(`bad node id "${s}" in "${token}" (ids are 0..255)`);
  }
  return Number(s);
}

/** Parse the text format. Returns null when the text lists no links. Throws on a malformed token. */
export function parseTopology(text: string): Topology | null {
  const keys = new Set<number>();
  const body = text.split('\n').map((line) => line.replace(/#.*$/, '')).join('\n');
  for (const token of body.split(/[\s;]+/)) {
    if (token === '') continue;
    const m = /^([^>-]+)([>-])(.+)$/.exec(token);
    if (!m) throw new Error(`bad link "${token}" (expected a-b, a-b,c or a>b)`);
    const from = parseId(m[1]!, token);
    const twoWay = m[2] === '-';
    for (const part of m[3]!.split(',')) {
      const to = parseId(part, token);
      if (to === from) throw new Error(`node ${from} cannot link to itself in "${token}"`);
      keys.add(from * 256 + to);
      if (twoWay) keys.add(to * 256 + from);
    }
  }
  if (keys.size === 0) return null;
  const links = [...keys].sort((a, b) => a - b).map((k) => [Math.floor(k / 256), k % 256] as const);
  return { links };
}

/** Canonical text: two-way pairs as "a-b", one-way links as "a>b", one per line. */
export function formatTopology(t: Topology | null): string {
  if (!t) return '';
  const set = new Set(t.links.map(([a, b]) => a * 256 + b));
  const out: string[] = [];
  for (const [a, b] of t.links) {
    if (set.has(b * 256 + a)) {
      if (a < b) out.push(`${a}-${b}`);
    } else {
      out.push(`${a}>${b}`);
    }
  }
  return out.join('\n');
}

const cache = new WeakMap<Topology, Set<number>>();

/** True when `listener` hears `speaker` under this topology. */
export function hears(t: Topology, speaker: number, listener: number): boolean {
  let set = cache.get(t);
  if (!set) {
    set = new Set(t.links.map(([a, b]) => a * 256 + b));
    cache.set(t, set);
  }
  return set.has(speaker * 256 + listener);
}

/** True when the node appears in at least one link. */
export function hasLinks(t: Topology, node: number): boolean {
  return t.links.some(([a, b]) => a === node || b === node);
}
