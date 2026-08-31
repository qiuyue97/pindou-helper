import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import { hexToRgb, rgbToHex, hexToLab, deltaE76, deltaE00 } from './color';

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

describe('deltaE76', () => {
  test('is plain Lab Euclidean distance', () => {
    expect(deltaE76([50, 0, 0], [50, 3, 4])).toBeCloseTo(5, 10);
  });
});

describe('deltaE00 vs Sharma reference dataset', () => {
  const rows = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__/ciede2000-sharma.csv'),
    'utf8',
  )
    .trim()
    .split(/\r?\n/)
    .slice(1);

  for (const row of rows) {
    test(`pair ${row}`, () => {
      const [L1, a1, b1, L2, a2, b2, want] = row.split(',').map(Number);
      const got = deltaE00([L1!, a1!, b1!], [L2!, a2!, b2!]);
      expect(Math.abs(got - want!)).toBeLessThan(1e-4);
    });
  }

  test('is symmetric', () => {
    const p: [number, number, number] = [40, 12, -5];
    const q: [number, number, number] = [45, -3, 20];
    expect(Math.abs(deltaE00(p, q) - deltaE00(q, p))).toBeLessThan(1e-9);
  });
});
