import { describe, test, expect } from 'vitest';
import type { EffectiveColor } from './catalog';
import { rgbToLab, type Lab } from './color';
import { selectCandidates, buildIndex, rankMatches, verdict, type RankResult } from './match';

const mk = (
  code: string,
  series: string,
  hex: string,
  source: EffectiveColor['source'] = 'base',
): EffectiveColor => {
  const rgb = [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ] as [number, number, number];
  return { code, series, hex, rgb, lab: rgbToLab(rgb), source };
};

describe('selectCandidates', () => {
  const eff = [
    mk('A1', 'A', 'FAF4C8'),
    mk('P1', 'P', 'FCF7F8'),
    mk('X1', 'X', 'A03D2F', 'custom'),
  ];
  test('221 keeps only A–M series, custom controlled by flag', () => {
    expect(selectCandidates(eff, '221', false).map((c) => c.code)).toEqual(['A1']);
    expect(selectCandidates(eff, '221', true).map((c) => c.code).sort()).toEqual(['A1', 'X1']);
  });
  test('291 keeps all non-custom, plus custom when included', () => {
    expect(selectCandidates(eff, '291', false).map((c) => c.code).sort()).toEqual(['A1', 'P1']);
    expect(selectCandidates(eff, '291', true).map((c) => c.code).sort()).toEqual(['A1', 'P1', 'X1']);
  });
});

describe('buildIndex + rankMatches', () => {
  const cands = [
    mk('D1', 'D', '191919'), // L ~ 10
    mk('D2', 'D', '7F7F7F'), // L ~ 53
    mk('D3', 'D', '808385'), // near D2
    mk('D4', 'D', 'E6E6E6'), // L ~ 91
  ];

  test('spacing reflects each colour’s own nearest neighbours', () => {
    const idx = buildIndex(cands, 3);
    expect(idx.spacing.get('D2')!).toBeLessThan(idx.spacing.get('D1')!);
  });

  test('ranks by CIEDE2000 ascending and computes relative against local spacing', () => {
    const idx = buildIndex(cands, 3);
    const sample: Lab = rgbToLab([0x80, 0x80, 0x80]); // basically D2
    const r = rankMatches(sample, cands, idx);
    expect(r.best.color.code).toBe('D2');
    expect(r.best.dE00).toBeLessThan(1);
    expect(r.best.relative).toBeLessThan(1); // sits inside D2's territory
    expect(r.list.every((row, i) => i === 0 || r.list[i - 1]!.dE00 <= row.dE00)).toBe(true);
    expect(r.list[0]!.color.code).toBe('D2');
  });

  test('flags ambiguity when the top two are within margin 1.0', () => {
    const pair = [
      mk('E1', 'E', 'FF8080'),
      mk('E2', 'E', 'FF8484'),
      mk('E3', 'E', '00FF00'),
    ];
    const idx = buildIndex(pair, 3);
    const sample: Lab = rgbToLab([0xff, 0x82, 0x82]);
    const r = rankMatches(sample, pair, idx);
    expect(new Set([r.best.color.code, r.ambiguousWith?.code])).toEqual(new Set(['E1', 'E2']));
  });

  test('throws when there are fewer than two candidates', () => {
    expect(() => rankMatches(rgbToLab([0, 0, 0]), [cands[0]!], buildIndex([cands[0]!]))).toThrow();
  });
});

describe('verdict', () => {
  const base = (dE: number, relative = 0.3, ambiguous = false): RankResult => ({
    best: { color: { code: 'C12' } as EffectiveColor, dE00: dE, relative },
    list: [],
    margin: ambiguous ? 0.5 : 5,
    ratio: ambiguous ? 0.9 : 0.2,
    ambiguousWith: ambiguous ? ({ code: 'C7' } as EffectiveColor) : undefined,
  });

  test('threshold buckets', () => {
    expect(verdict(base(0.5)).text).toBe('几乎完全一致');
    expect(verdict(base(1.5)).text).toBe('非常接近，肉眼难辨');
    expect(verdict(base(3.0)).text).toBe('很接近');
    expect(verdict(base(4.5)).text).toBe('接近');
    expect(verdict(base(8)).text).toBe('有可见色差');
    expect(verdict(base(20)).text).toBe('差异明显，色卡里可能没有很匹配的颜色');
  });

  test('appends ambiguity and territory clauses', () => {
    expect(verdict(base(3.0, 0.3, true)).text).toBe('很接近，与 C7 难以区分');
    expect(verdict(base(3.0, 1.5, false)).text).toBe('很接近，落在多个色号之间，建议核对');
  });
});
