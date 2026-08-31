import { describe, test, expect } from 'vitest';
import { hexToRgb, rgbToHex, hexToLab } from './color';

const closeTo = (got: number[], want: number[], eps: number) =>
  got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThanOrEqual(eps));

describe('hex <-> rgb', () => {
  test('parses with and without hash, any case', () => {
    expect(hexToRgb('#FF0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('00ff80')).toEqual([0, 255, 128]);
  });
  test('rejects malformed input', () => {
    expect(() => hexToRgb('xyz')).toThrow();
    expect(() => hexToRgb('#FFF')).toThrow();
  });
  test('round-trips', () => {
    expect(rgbToHex(hexToRgb('#1E334D'))).toBe('1E334D');
    expect(rgbToHex([255.6, -3, 300])).toBe('FF00FF');
  });
});

describe('hex -> CIELAB (D65)', () => {
  test('pure red matches the canonical value', () => {
    closeTo(hexToLab('FF0000'), [53.2408, 80.0925, 67.2032], 0.05);
  });
  test('black and white', () => {
    closeTo(hexToLab('000000'), [0, 0, 0], 0.02);
    closeTo(hexToLab('FFFFFF'), [100, 0, 0], 0.02);
  });
  test('mid grey is neutral', () => {
    const [L, a, b] = hexToLab('808080');
    expect(L).toBeGreaterThan(50);
    expect(L).toBeLessThan(56);
    closeTo([a, b], [0, 0], 0.02);
  });
});
