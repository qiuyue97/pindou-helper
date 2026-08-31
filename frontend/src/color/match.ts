import type { EffectiveColor } from './catalog';
import { deltaE00, type Lab } from './color';

export type CandidateSet = '221' | '291';
export const SERIES_221 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M'] as const;
const S221 = new Set<string>(SERIES_221);

export function selectCandidates(
  effective: EffectiveColor[],
  set: CandidateSet,
  includeCustom = true,
): EffectiveColor[] {
  return effective.filter((c) => {
    if (c.source === 'custom') return includeCustom;
    return set === '291' || S221.has(c.series);
  });
}

export interface SpacingIndex {
  spacing: Map<string, number>;
}

export function buildIndex(candidates: EffectiveColor[], k = 3): SpacingIndex {
  const spacing = new Map<string, number>();
  for (const c of candidates) {
    const others = candidates
      .filter((o) => o !== c)
      .map((o) => deltaE00(c.lab, o.lab))
      .sort((a, b) => a - b)
      .slice(0, k);
    spacing.set(c.code, others.length ? others.reduce((s, v) => s + v, 0) / others.length : 0);
  }
  return { spacing };
}

export interface MatchRow {
  color: EffectiveColor;
  dE00: number;
  relative: number;
}

export interface RankResult {
  best: MatchRow;
  list: MatchRow[];
  margin: number;
  ratio: number;
  ambiguousWith?: EffectiveColor;
}

export function rankMatches(
  sampleLab: Lab,
  candidates: EffectiveColor[],
  index: SpacingIndex,
): RankResult {
  if (candidates.length < 2) {
    throw new Error('rankMatches: need at least 2 candidates');
  }
  const list: MatchRow[] = candidates
    .map((color) => {
      const dE00 = deltaE00(sampleLab, color.lab);
      const spacing = index.spacing.get(color.code) ?? 0;
      const relative = spacing > 0 ? dE00 / (0.5 * spacing) : Infinity;
      return { color, dE00, relative };
    })
    .sort((a, b) => a.dE00 - b.dE00 || a.color.code.localeCompare(b.color.code));

  const best = list[0]!;
  const second = list[1]!;
  const margin = second.dE00 - best.dE00;
  const ratio = second.dE00 === 0 ? 1 : best.dE00 / second.dE00;
  const ambiguousWith = margin < 1.0 || ratio > 0.85 ? second.color : undefined;

  return { best, list, margin, ratio, ambiguousWith };
}

export interface Verdict {
  text: string;
  ambiguousWith?: EffectiveColor;
}

function bucket(dE: number): string {
  if (dE < 1.0) return '几乎完全一致';
  if (dE < 2.0) return '非常接近，肉眼难辨';
  if (dE < 3.5) return '很接近';
  if (dE < 5.0) return '接近';
  if (dE < 10) return '有可见色差';
  return '差异明显，色卡里可能没有很匹配的颜色';
}

export function verdict(r: RankResult): Verdict {
  let text = bucket(r.best.dE00);
  if (r.ambiguousWith) text += `，与 ${r.ambiguousWith.code} 难以区分`;
  if (r.best.relative > 1.2) text += '，落在多个色号之间，建议核对';
  return { text, ambiguousWith: r.ambiguousWith };
}
