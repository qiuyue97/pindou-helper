import { describe, expect, test } from 'vitest';
import { buildEffectiveCatalog, loadBaseCatalog } from '../color/catalog';
import {
  ALL_CODE,
  expandWildcard,
  isAllCode,
  isWildcard,
  scopeCodes,
  seriesOfCode,
  seriesWildcard,
} from './allScope';

const base = buildEffectiveCatalog(loadBaseCatalog(), []);
const withCustom = buildEffectiveCatalog(loadBaseCatalog(), [
  { code: 'X1', hex: 'A03D2F', source: 'custom' },
]);

describe('isAllCode', () => {
  test('matches the wildcard case-insensitively', () => {
    expect(ALL_CODE).toBe('ALL');
    expect(isAllCode('ALL')).toBe(true);
    expect(isAllCode('all')).toBe(true);
    expect(isAllCode('A1')).toBe(false);
    expect(isAllCode(null)).toBe(false);
  });
});

describe('scopeCodes', () => {
  test('221 covers only the A–M series', () => {
    const codes = scopeCodes(base, '221', true);
    expect(codes).toHaveLength(221);
    expect(codes).toContain('A1');
    expect(codes).toContain('M15');
    expect(codes.some((c) => c.startsWith('T'))).toBe(false);
  });

  test('291 covers everything', () => {
    expect(scopeCodes(base, '291', true)).toHaveLength(291);
  });

  test('custom colours follow the include flag', () => {
    expect(scopeCodes(withCustom, '221', true)).toContain('X1');
    expect(scopeCodes(withCustom, '221', false)).not.toContain('X1');
    expect(scopeCodes(withCustom, '221', true)).toHaveLength(222);
  });
});


describe('series wildcards', () => {
  const scope = ['A1', 'A2', 'B1', 'ZG1', 'ZG2', 'M3'];

  test('recognises a series wildcard in any case', () => {
    expect(seriesWildcard('A*')).toBe('A');
    expect(seriesWildcard('a*')).toBe('A');
    expect(seriesWildcard(' b* ')).toBe('B');
  });

  test('treats a multi-letter series as one unit', () => {
    // ZG is a series of its own, so ZG* must not be read as series Z.
    expect(seriesWildcard('zg*')).toBe('ZG');
    expect(seriesOfCode('ZG1')).toBe('ZG');
    expect(expandWildcard('ZG*', scope)).toEqual(['ZG1', 'ZG2']);
  });

  test('plain codes are not wildcards', () => {
    expect(seriesWildcard('A1')).toBeNull();
    expect(isWildcard('A1')).toBe(false);
    expect(isWildcard(null)).toBe(false);
    expect(expandWildcard('A1', scope)).toBeNull();
  });

  test('ALL and A* are both wildcards', () => {
    expect(isWildcard('ALL')).toBe(true);
    expect(isWildcard('all')).toBe(true);
    expect(isWildcard('A*')).toBe(true);
  });

  test('a series wildcard covers only its own series', () => {
    expect(expandWildcard('A*', scope)).toEqual(['A1', 'A2']);
  });

  test('ALL covers the whole scope', () => {
    expect(expandWildcard('ALL', scope)).toEqual(scope);
  });

  test('an unknown series covers nothing, so callers can reject it', () => {
    expect(expandWildcard('X*', scope)).toEqual([]);
  });
});
