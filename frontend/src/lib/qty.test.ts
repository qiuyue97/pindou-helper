import { describe, expect, test } from 'vitest';
import { formatChanges, qtyTier } from './qty';

describe('qtyTier', () => {
  test('negative / low / ok', () => {
    expect(qtyTier(-1, 500)).toBe('negative');
    expect(qtyTier(0, 500)).toBe('low');
    expect(qtyTier(499, 500)).toBe('low');
    expect(qtyTier(500, 500)).toBe('ok');
  });
});

describe('formatChanges', () => {
  test('renders one change', () => {
    expect(formatChanges([{ code: 'A1', from: 900, to: 1200 }])).toBe('A1 900→1200');
  });
  test('renders created and deleted rows with an em dash', () => {
    expect(formatChanges([{ code: 'A1', from: null, to: 100 }])).toBe('A1 —→100');
    expect(formatChanges([{ code: 'A1', from: 100, to: null }])).toBe('A1 100→—');
  });
  test('summarises multiple changes', () => {
    expect(
      formatChanges([
        { code: 'A1', from: 1, to: 2 },
        { code: 'B2', from: 3, to: 4 },
      ]),
    ).toBe('A1 1→2，B2 3→4（2 个色号受影响）');
  });
  test('handles no change', () => {
    expect(formatChanges([])).toBe('库存无变化');
  });
});
