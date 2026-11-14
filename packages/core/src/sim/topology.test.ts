import { describe, expect, it } from 'vitest';
import { formatTopology, hasLinks, hears, parseTopology } from './topology.ts';

describe('topology', () => {
  it('parses two-way links, comma shorthand, one-way links, comments and ;', () => {
    const t = parseTopology('# star\n0-1,2   # zero hub\n4>5; 1-3\n')!;
    expect(t.links).toEqual([[0, 1], [0, 2], [1, 0], [1, 3], [2, 0], [3, 1], [4, 5]]);
    expect(hears(t, 0, 1)).toBe(true);
    expect(hears(t, 1, 0)).toBe(true);
    expect(hears(t, 1, 2)).toBe(false);
    expect(hears(t, 4, 5)).toBe(true);
    expect(hears(t, 5, 4)).toBe(false);
    expect(hasLinks(t, 5)).toBe(true);
    expect(hasLinks(t, 6)).toBe(false);
  });

  it('returns null (distance mode) for text with no links', () => {
    expect(parseTopology('')).toBeNull();
    expect(parseTopology('  \n# nothing here\n ; ')).toBeNull();
  });

  it('rejects bad ids, self-links and junk', () => {
    expect(() => parseTopology('0-256')).toThrow(/256/);
    expect(() => parseTopology('3-3')).toThrow(/itself/);
    expect(() => parseTopology('hello')).toThrow(/hello/);
    expect(() => parseTopology('1-')).toThrow();
    expect(() => parseTopology('1-2,,3')).toThrow();
    expect(() => parseTopology('-1-2')).toThrow();
  });

  it('formats canonically and round-trips', () => {
    const t = parseTopology('2-0 1-0 4>5 5>4 6>7')!;
    const text = formatTopology(t);
    expect(text).toBe('0-1\n0-2\n4-5\n6>7');
    expect(parseTopology(text)).toEqual(t);
    expect(formatTopology(null)).toBe('');
  });
});
