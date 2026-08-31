import { describe, test, expect } from 'vitest';
import type { EffectiveColor } from './catalog';
import type { Lab } from './color';
import { mahalanobisRanking, euclideanRanking } from './debugMetrics';

const mk = (code: string, lab: Lab): EffectiveColor => ({
  code,
  series: code[0]!,
  hex: '000000',
  rgb: [0, 0, 0],
  lab,
  source: 'base',
});

const spread = [
  mk('A', [10, -20, -30]),
  mk('B', [30, 0, -10]),
  mk('C', [50, 20, 10]),
  mk('D', [70, 40, 30]),
  mk('E', [90, 60, 50]),
];

describe('euclideanRanking', () => {
  test('is deltaE76 ascending', () => {
    const r = euclideanRanking([50, 20, 10], spread);
    expect(r[0]!.code).toBe('C');
    expect(r.every((row, i) => i === 0 || r[i - 1]!.distance <= row.distance)).toBe(true);
  });
});

describe('mahalanobisRanking', () => {
  test('returns every candidate, sorted ascending, finite distances', () => {
    const r = mahalanobisRanking([50, 20, 10], spread);
    expect(r).toHaveLength(spread.length);
    expect(r[0]!.code).toBe('C');
    expect(r.every((row) => Number.isFinite(row.distance))).toBe(true);
    expect(r.every((row, i) => i === 0 || r[i - 1]!.distance <= row.distance)).toBe(true);
  });

  test('does not blow up on collinear candidates (singular covariance)', () => {
    const collinear = [
      mk('P', [0, 0, 0]),
      mk('Q', [10, 10, 10]),
      mk('R', [20, 20, 20]),
    ];
    const r = mahalanobisRanking([5, 5, 5], collinear);
    expect(r.every((row) => Number.isFinite(row.distance))).toBe(true);
  });
});
