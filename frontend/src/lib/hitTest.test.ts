import { describe, expect, test } from 'vitest';
import { nearestPoint } from './hitTest';

const pts = [
  { code: 'A1', x: 10, y: 10 },
  { code: 'B2', x: 100, y: 100 },
];

describe('nearestPoint', () => {
  test('finds a point within the radius', () => {
    expect(nearestPoint(pts, 12, 13, 10)?.code).toBe('A1');
  });
  test('returns null when nothing is close enough', () => {
    expect(nearestPoint(pts, 55, 55, 10)).toBeNull();
  });
  test('picks the closer of two candidates', () => {
    expect(nearestPoint(pts, 96, 96, 50)?.code).toBe('B2');
  });
  test('handles an empty set', () => {
    expect(nearestPoint([], 0, 0, 10)).toBeNull();
  });
});
