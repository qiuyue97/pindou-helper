import type { EffectiveColor } from '../color/catalog';
import { SERIES_221, type CandidateSet } from '../color/match';

/**
 * The wildcard code a user can type in a batch dialog to mean "every colour in
 * the chosen scope". Mirrors `ALL_CODE` in `backend/app/text_parse.py`.
 */
export const ALL_CODE = 'ALL';

/** "A*" — every colour of one series. Mirrors `_SERIES_WILDCARD_RE`. */
const SERIES_WILDCARD_RE = /^([A-Za-z]+)\*$/;

const S221 = new Set<string>(SERIES_221);

export function isAllCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && code.trim().toUpperCase() === ALL_CODE;
}

/** The series a wildcard code targets, or null when it is not one. */
export function seriesWildcard(code: string | null | undefined): string | null {
  if (typeof code !== 'string') return null;
  const m = SERIES_WILDCARD_RE.exec(code.trim());
  return m ? m[1]!.toUpperCase() : null;
}

export function isWildcard(code: string | null | undefined): boolean {
  return isAllCode(code) || seriesWildcard(code) !== null;
}

/**
 * The codes a wildcard covers, or null when `code` is not a wildcard.
 * Mirrors `expand_wildcard()` on the backend: `scope` is already filtered to
 * 221/291 and custom colours, so neither is re-decided here.
 */
export function expandWildcard(code: string | null | undefined, scope: string[]): string[] | null {
  if (isAllCode(code)) return scope;
  const series = seriesWildcard(code);
  if (series === null) return null;
  return scope.filter((c) => seriesOfCode(c) === series);
}

/** Leading letters of a code, upper-cased. Mirrors `series_of()`. */
export function seriesOfCode(code: string): string {
  const m = /^[A-Za-z]+/.exec(code);
  return m ? m[0].toUpperCase() : '';
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
