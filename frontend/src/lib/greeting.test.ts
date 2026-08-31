import { describe, expect, test } from 'vitest';
import { greetingFor } from './greeting';

describe('greetingFor', () => {
  test.each([
    [0, '凌晨好'],
    [3, '凌晨好'],
    [5, '凌晨好'],
    [6, '早上好'],
    [9, '早上好'],
    [11, '早上好'],
    [12, '中午好'],
    [15, '中午好'],
    [17, '中午好'],
    [18, '晚上好'],
    [23, '晚上好'],
  ])('%s 点 → %s', (hour, expected) => {
    expect(greetingFor(hour)).toBe(expected);
  });

  test('covers every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      expect(greetingFor(h)).toMatch(/^(凌晨|早上|中午|晚上)好$/);
    }
  });

  test('accepts a Date as well as an hour', () => {
    const d = new Date();
    d.setHours(20, 0, 0, 0);
    expect(greetingFor(d)).toBe('晚上好');
  });
});
