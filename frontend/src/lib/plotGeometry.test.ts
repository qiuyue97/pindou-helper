import { describe, expect, test } from 'vitest';
import type { Lab } from '../color/color';
import { project3d } from '../color/neighbors';
import {
  clampSegmentToBox,
  lightnessScale,
  orbitScale,
  planeScale,
  zoomAbout,
} from './plotGeometry';

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

describe('clampSegmentToBox', () => {
  const b = { width: 100, height: 100, pad: 0 };

  test('leaves an endpoint alone when it is already inside', () => {
    const p = clampSegmentToBox({ x: 50, y: 50 }, { x: 70, y: 60 }, b, 10);
    expect(p.x).toBeCloseTo(70, 6);
    expect(p.y).toBeCloseTo(60, 6);
  });

  test('pulls an endpoint back to the inset edge when it overshoots', () => {
    // straight right, way past the edge
    const p = clampSegmentToBox({ x: 50, y: 50 }, { x: 500, y: 50 }, b, 10);
    expect(p.x).toBeCloseTo(90, 6); // width - inset
    expect(p.y).toBeCloseTo(50, 6);
  });

  test('keeps the point on the original line when clamping diagonally', () => {
    const p = clampSegmentToBox({ x: 50, y: 50 }, { x: 250, y: 250 }, b, 10);
    // the ray is y = x, so the clamped point must still satisfy it
    expect(p.x).toBeCloseTo(p.y, 6);
    expect(p.x).toBeLessThanOrEqual(90);
  });

  test('clamps in the negative direction too', () => {
    const p = clampSegmentToBox({ x: 50, y: 50 }, { x: -500, y: 50 }, b, 10);
    expect(p.x).toBeCloseTo(10, 6);
  });

  test('never returns a point behind the start', () => {
    const p = clampSegmentToBox({ x: 5, y: 5 }, { x: -100, y: 5 }, b, 10);
    expect(p.x).toBeCloseTo(5, 6); // start is already outside the inset box
  });
});

describe('axis labels stay on screen at any zoom', () => {
  const SIZE = 320;
  const AXIS = 60;
  const box = { width: SIZE, height: SIZE, pad: 0 };

  // Mirrors what ColorSpace3D does: project, fit, apply zoom about the centre,
  // then clamp the label anchor back inside the canvas.
  function anchorFor(axis: 'L' | 'a' | 'b', zoom: number, az: number, el: number) {
    const end: Lab =
      axis === 'L' ? [50 + AXIS, 0, 0] : axis === 'a' ? [50, AXIS, 0] : [50, 0, AXIS];
    const pts = [
      project3d([50, 0, 0] as Lab, az, el),
      project3d(end, az, el),
      project3d([50 - AXIS, 0, 0] as Lab, az, el),
      project3d([50, -AXIS, 0] as Lab, az, el),
      project3d([50, 0, -AXIS] as Lab, az, el),
    ];
    const base = orbitScale(pts, { width: SIZE, height: SIZE, pad: 28 });
    const c = SIZE / 2;
    const zoomed = (p: { x: number; y: number }) => {
      const q = base.toScreen(p);
      return { x: c + (q.x - c) * zoom, y: c + (q.y - c) * zoom };
    };
    return clampSegmentToBox(zoomed(pts[0]!), zoomed(pts[1]!), box, 14);
  }

  test.each([1, 2, 4, 8])('zoom %s× keeps every axis label inside the canvas', (zoom) => {
    for (const axis of ['L', 'a', 'b'] as const) {
      for (const [az, el] of [
        [35, 20],
        [0, 0],
        [120, -60],
        [270, 75],
      ] as [number, number][]) {
        const p = anchorFor(axis, zoom, az, el);
        expect(p.x).toBeGreaterThanOrEqual(-0.001);
        expect(p.x).toBeLessThanOrEqual(SIZE + 0.001);
        expect(p.y).toBeGreaterThanOrEqual(-0.001);
        expect(p.y).toBeLessThanOrEqual(SIZE + 0.001);
      }
    }
  });

  test('at 1× the label sits at the axis end, not the border', () => {
    const near = anchorFor('a', 1, 0, 0);
    const far = anchorFor('a', 8, 0, 0);
    // zoomed in, the anchor is pinned to the edge and therefore further right
    expect(far.x).toBeGreaterThan(near.x);
  });
});

describe('zoomAbout', () => {
  const anchor = { x: 40, y: 90 };

  test('zoom 1x changes nothing', () => {
    expect(zoomAbout({ x: 10, y: 20 }, anchor, 1)).toEqual({ x: 10, y: 20 });
  });

  test('the anchor itself never moves, at any zoom', () => {
    for (const z of [0.5, 1, 2, 8]) {
      const p = zoomAbout(anchor, anchor, z);
      expect(p.x).toBeCloseTo(anchor.x, 9);
      expect(p.y).toBeCloseTo(anchor.y, 9);
    }
  });

  test('distances from the anchor scale by the zoom factor', () => {
    const p = zoomAbout({ x: 60, y: 90 }, anchor, 3);
    expect(p.x - anchor.x).toBeCloseTo((60 - anchor.x) * 3, 9);
    expect(p.y).toBeCloseTo(anchor.y, 9);
  });

  test('a point sampled far from the origin stays put while its neighbours spread', () => {
    // the anchor is the sample; a nearby neighbour must move away from it, not
    // sweep the sample off-screen
    const near = { x: 45, y: 92 };
    const zoomed = zoomAbout(near, anchor, 4);
    expect(Math.hypot(zoomed.x - anchor.x, zoomed.y - anchor.y)).toBeCloseTo(
      Math.hypot(near.x - anchor.x, near.y - anchor.y) * 4,
      9,
    );
  });
});

describe('an off-centre sample survives zooming (the 3D regression)', () => {
  const SIZE = 320;
  const AXIS = 60;

  // Mirrors ColorSpace3D: project everything, fit, then zoom about the SAMPLE.
  function samplePosAtZoom(sample: Lab, others: Lab[], zoom: number, az = 35, el = 20) {
    const pts = [
      ...others.map((l) => project3d(l, az, el)),
      project3d(sample, az, el),
      project3d([50 + AXIS, 0, 0] as Lab, az, el),
      project3d([50 - AXIS, 0, 0] as Lab, az, el),
      project3d([50, AXIS, 0] as Lab, az, el),
      project3d([50, -AXIS, 0] as Lab, az, el),
      project3d([50, 0, AXIS] as Lab, az, el),
      project3d([50, 0, -AXIS] as Lab, az, el),
    ];
    const base = orbitScale(pts, { width: SIZE, height: SIZE, pad: 28 });
    const anchor = base.toScreen(project3d(sample, az, el));
    return zoomAbout(base.toScreen(project3d(sample, az, el)), anchor, zoom);
  }

  // F5 #E7002F — a hard red, about as far from the neutral axis as the palette gets
  const vivid: Lab = [49, 75, 43];
  const neighbours: Lab[] = [
    [50, 0, 0],
    [80, -65, 68],
    [38, 23, -62],
  ];

  test.each([1, 2, 4, 8])('sample stays on canvas at %s×', (zoom) => {
    const p = samplePosAtZoom(vivid, neighbours, zoom);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(SIZE);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(SIZE);
  });

  test('the sample does not move at all as the zoom changes', () => {
    const at1 = samplePosAtZoom(vivid, neighbours, 1);
    const at8 = samplePosAtZoom(vivid, neighbours, 8);
    expect(at8.x).toBeCloseTo(at1.x, 9);
    expect(at8.y).toBeCloseTo(at1.y, 9);
  });
});
