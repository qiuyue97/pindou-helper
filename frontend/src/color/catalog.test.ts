import { describe, test, expect } from 'vitest';
import { loadBaseCatalog, seriesOf, buildEffectiveCatalog } from './catalog';
import { hexToLab } from './color';

describe('loadBaseCatalog', () => {
  test('returns the 291 committed colours', () => {
    const base = loadBaseCatalog();
    expect(base).toHaveLength(291);
    expect(base[0]).toMatchObject({ code: 'A1', series: 'A' });
    expect(base.every((c) => /^[0-9A-F]{6}$/.test(c.hex))).toBe(true);
  });
});

describe('seriesOf', () => {
  test('takes the leading letters', () => {
    expect(seriesOf('A1')).toBe('A');
    expect(seriesOf('zg8')).toBe('ZG');
    expect(seriesOf('MY-RED')).toBe('MY');
  });
  test('falls back to 自定义 when there are no leading letters', () => {
    expect(seriesOf('123')).toBe('自定义');
  });
});

describe('buildEffectiveCatalog', () => {
  const base = [
    { code: 'A1', series: 'A', hex: 'FAF4C8' },
    { code: 'C7', series: 'C', hex: '971937' },
  ];

  test('base-only: passes through, adds rgb/lab, source=base', () => {
    const eff = buildEffectiveCatalog(base, []);
    expect(eff).toHaveLength(2);
    expect(eff[0]).toMatchObject({ code: 'A1', source: 'base', hex: 'FAF4C8' });
    expect(eff[0]!.lab).toEqual(hexToLab('FAF4C8'));
  });

  test('override replaces hex + lab and marks source=override, keeping position', () => {
    const eff = buildEffectiveCatalog(base, [{ code: 'C7', hex: '9D5B3E', source: 'override' }]);
    expect(eff[1]).toMatchObject({ code: 'C7', hex: '9D5B3E', source: 'override', series: 'C' });
    expect(eff[1]!.lab).toEqual(hexToLab('9D5B3E'));
  });

  test('custom code is appended with derived series and source=custom', () => {
    const eff = buildEffectiveCatalog(base, [{ code: 'X1', hex: 'A03D2F', source: 'custom' }]);
    expect(eff).toHaveLength(3);
    expect(eff[2]).toMatchObject({ code: 'X1', series: 'X', source: 'custom' });
  });

  test('a userColor whose code is unknown is treated as custom even if it claims override', () => {
    const eff = buildEffectiveCatalog(base, [{ code: 'ZZ9', hex: '000000', source: 'override' }]);
    expect(eff[2]).toMatchObject({ code: 'ZZ9', source: 'custom' });
  });
});
