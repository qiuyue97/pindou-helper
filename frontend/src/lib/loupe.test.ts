import { describe, expect, test } from 'vitest';
import { loupePosition } from './loupe';

const L = 120;
const GAP = 16;
const canvas = { width: 400, height: 300 };
const place = (x: number, y: number, c = canvas) => loupePosition(x, y, c, L, GAP);

const inside = (p: { left: number; top: number }, c = canvas) =>
  p.left >= 0 && p.top >= 0 && p.left + L <= c.width && p.top + L <= c.height;

describe('loupePosition', () => {
  test('sits above the point when there is room', () => {
    const p = place(200, 250);
    expect(p.top).toBe(250 - GAP - L);
    expect(p.left).toBe(200 - L / 2);
    expect(inside(p)).toBe(true);
  });

  test('flips below when the point is near the top edge', () => {
    const p = place(200, 20);
    expect(p.top).toBe(20 + GAP);
    expect(inside(p)).toBe(true);
  });

  test('never covers the point it is magnifying', () => {
    for (const y of [10, 60, 150, 290]) {
      const p = place(200, y);
      const above = p.top + L <= y;
      const below = p.top >= y;
      expect(above || below).toBe(true);
    }
  });

  test('clamps horizontally at both edges', () => {
    expect(place(5, 250).left).toBe(0);
    expect(place(395, 250).left).toBe(canvas.width - L);
  });

  test('stays fully visible anywhere on the canvas', () => {
    for (let x = 0; x <= canvas.width; x += 40) {
      for (let y = 0; y <= canvas.height; y += 30) {
        expect(inside(place(x, y))).toBe(true);
      }
    }
  });

  test('still returns something usable on a canvas smaller than the loupe', () => {
    const tiny = { width: 80, height: 60 };
    const p = place(40, 30, tiny);
    expect(p.left).toBe(0);
    expect(p.top).toBe(0);
  });
});
