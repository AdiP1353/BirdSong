import { describe, expect, it } from 'vitest';
import { ENV_NAMES, PROFILE_NAMES, PROFILES } from '../envs.ts';
import { SYNC_MS } from '../timing.ts';
import { buildSymbolTemplates, buildSyncTemplate } from './templates.ts';
import type { ComplexTemplate } from './templates.ts';

function ncc(a: ComplexTemplate, b: ComplexTemplate): number {
  let re = 0;
  let im = 0;
  for (let n = 0; n < a.re.length; n++) {
    // a * conj(b)
    re += a.re[n]! * b.re[n]! + a.im[n]! * b.im[n]!;
    im += a.im[n]! * b.re[n]! - a.re[n]! * b.im[n]!;
  }
  return Math.hypot(re, im) / Math.sqrt(a.energy * b.energy);
}

describe('templates', () => {
  for (const env of ENV_NAMES) {
    for (const profile of PROFILE_NAMES) {
      it(`${env}/${profile}: symbol templates are well separated`, () => {
        const { templates } = buildSymbolTemplates(env, profile, 48_000);
        expect(templates.length).toBe(1 << PROFILES[profile].bitsPerSymbol);
        let max = 0;
        let arg = [0, 0];
        for (let i = 0; i < templates.length; i++) {
          for (let j = 0; j < templates.length; j++) {
            const c = ncc(templates[i]!, templates[j]!);
            if (i === j) {
              expect(Math.abs(c - 1)).toBeLessThan(1e-3);
            } else if (c > max) {
              max = c;
              arg = [i, j];
            }
          }
        }
        console.log(`template max off-diagonal correlation ${env}/${profile}: ${max.toFixed(3)} (symbols ${arg[0]} vs ${arg[1]})`);
        expect(max).toBeLessThan(0.6);
      });
    }
  }

  it('sync template has SYNC_MS length and a silent middle', () => {
    const sr = 48_000;
    const t = buildSyncTemplate('quiet', sr);
    expect(t.re.length).toBe(Math.round((SYNC_MS * sr) / 1000));
    const mid = Math.round(0.07 * sr);
    expect(Math.hypot(t.re[mid]!, t.im[mid]!)).toBe(0);
    expect(t.energy).toBeGreaterThan(0);
  });
});
