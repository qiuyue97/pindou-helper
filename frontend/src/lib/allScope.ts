import type { EffectiveColor } from '../color/catalog';
import { SERIES_221, type CandidateSet } from '../color/match';

/**
 * The wildcard code a user can type in a batch dialog to mean "every colour in
 * the chosen scope". Mirrors `ALL_CODE` in `backend/app/text_parse.py`.
 */
export const ALL_CODE = 'ALL';

const S221 = new Set<string>(SERIES_221);

export function isAllCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && code.trim().toUpperCase() === ALL_CODE;
}

/** Ordered codes an ALL row expands to. Mirrors `scope_codes()` on the backend. */
export function scopeCodes(
  colors: EffectiveColor[],
  set: CandidateSet,
  includeCustom: boolean,
): string[] {
  const standard = colors
    .filter((c) => c.source !== 'custom' && (set === '291' || S221.has(c.series)))
    .map((c) => c.code);
  if (!includeCustom) return standard;
  const customs = colors
    .filter((c) => c.source === 'custom')
    .map((c) => c.code)
    .sort();
  return [...standard, ...customs];
}
