import { describe, expect, test } from 'vitest';
import { buildEffectiveCatalog, loadBaseCatalog } from '../color/catalog';
import { ALL_CODE, isAllCode, scopeCodes } from './allScope';

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
