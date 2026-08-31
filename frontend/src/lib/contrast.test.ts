import { describe, expect, test } from 'vitest';
import { swatchTextColor } from './contrast';

describe('swatchTextColor', () => {
  test('dark text on light blocks', () => {
    expect(swatchTextColor('FFFFFF')).toBe('dark');
    expect(swatchTextColor('FAF4C8')).toBe('dark'); // A1, pale yellow
  });
  test('light text on dark blocks', () => {
    expect(swatchTextColor('000000')).toBe('light');
    expect(swatchTextColor('182A84')).toBe('light'); // D4, deep blue
  });
});
