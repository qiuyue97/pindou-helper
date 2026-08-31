import { describe, expect, test } from 'vitest';
import type { Lab } from '../color/color';
import { lightnessScale, orbitScale, planeScale } from './plotGeometry';

const box = { width: 200, height: 200, pad: 20 };

describe('planeScale', () => {
  test('puts the origin at the centre', () => {
    const s = planeScale([[50, -40, 40] as Lab, [50, 40, -40] as Lab], box);
    const o = s.toScreen([50, 0, 0] as Lab);
    expect(o.x).toBeCloseTo(100, 6);
    expect(o.y).toBeCloseTo(100, 6);
  });

  test('maps +b* upward (canvas y is inverted)', () => {
    const s = planeScale([[50, 0, 40] as Lab, [50, 0, -40] as Lab], box);
    expect(s.toScreen([50, 0, 40] as Lab).y).toBeLessThan(s.toScreen([50, 0, -40] as Lab).y);
  });

  test('extreme points sit pad away from the edge', () => {
    const s = planeScale([[50, 40, 0] as Lab, [50, -40, 0] as Lab], box);
    expect(s.toScreen([50, 40, 0] as Lab).x).toBeCloseTo(box.width - box.pad, 6);
    expect(s.toScreen([50, -40, 0] as Lab).x).toBeCloseTo(box.pad, 6);
  });

  test('a degenerate cluster still gets a usable radius', () => {
    const s = planeScale([[50, 0, 0] as Lab], box);
    expect(s.radius).toBeGreaterThanOrEqual(10);
    expect(Number.isFinite(s.toScreen([50, 0, 0] as Lab).x)).toBe(true);
  });
});

describe('lightnessScale', () => {
  test('L*=100 is at the top, L*=0 at the bottom', () => {
    const s = lightnessScale(box);
    expect(s.toY(100)).toBeCloseTo(20, 6);
    expect(s.toY(0)).toBeCloseTo(180, 6);
    expect(s.toY(50)).toBeCloseTo(100, 6);
  });
});

describe('orbitScale', () => {
  test('centres and fits projected points', () => {
    const s = orbitScale([{ x: -10, y: -10 }, { x: 10, y: 10 }], box);
    expect(s.toScreen({ x: 0, y: 0 }).x).toBeCloseTo(100, 6);
    expect(s.toScreen({ x: 10, y: 10 }).x).toBeCloseTo(180, 6);
  });
});
