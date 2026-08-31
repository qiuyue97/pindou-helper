import { describe, test, expect } from 'vitest';
import type { EffectiveColor } from './catalog';
import { deltaE00, type Lab } from './color';
import { selectPlotSet, project3d } from './neighbors';

const mk = (code: string, lab: Lab): EffectiveColor => ({
  code,
  series: code[0]!,
  hex: '000000',
  rgb: [0, 0, 0],
  lab,
  source: 'base',
});

describe('selectPlotSet', () => {
  const sample: Lab = [50, 0, 0];
  // C_ALL: closest overall.  C_L / C_A / C_B: each is the single nearest on one
  // axis but only mid-pack overall, so the per-axis rule is what pulls them in.
  const cands = [
    mk('C_ALL', [52, 3, 3]),
    mk('C_L', [50.5, 25, 25]), // |dL| = 0.5  -> nearest on L
    mk('C_A', [70, 1.5, 30]), //  |da| = 1.5  -> nearest on a
    mk('C_B', [75, 30, 1]), //    |db| = 1    -> nearest on b
    mk('F1', [20, 40, 40]),
    mk('F2', [90, -40, -40]),
  ];
  const de = (c: EffectiveColor) => deltaE00(sample, c.lab);

  test('unions top-K with the per-axis nearest, deduped and distance-sorted', () => {
    const set = selectPlotSet(sample, cands, { topK: 2, perAxis: 2, cap: 8 });
    const codes = set.map((c) => c.code);
    expect(codes).toContain('C_ALL');
    expect(codes).toContain('C_A'); // per-axis a, outside top-2 by dE
    expect(codes).toContain('C_B'); // per-axis b, outside top-2 by dE
    expect(new Set(codes).size).toBe(codes.length); // deduped
    expect(set.length).toBeLessThanOrEqual(8);
    expect(set.every((c, i) => i === 0 || de(set[i - 1]!) <= de(c))).toBe(true);
    expect(set[0]!.code).toBe('C_ALL');
  });

  test('when the union exceeds cap, trims to the core plus the closest, never over cap', () => {
    const set = selectPlotSet(sample, cands, { topK: 2, perAxis: 3, cap: 3 });
    expect(set.length).toBeLessThanOrEqual(3);
    expect(set.map((c) => c.code)).toContain('C_ALL'); // core is always kept
  });
});

describe('project3d', () => {
  test('identity view maps a->x, L-50->y, b->depth', () => {
    const p = project3d([70, 12, -5], 0, 0);
    expect(p.x).toBeCloseTo(12, 10);
    expect(p.y).toBeCloseTo(20, 10);
    expect(p.depth).toBeCloseTo(-5, 10);
  });
  test('90-degree azimuth swaps a and b into x', () => {
    const p = project3d([50, 3, 7], 90, 0);
    expect(p.x).toBeCloseTo(7, 6);
  });
});
