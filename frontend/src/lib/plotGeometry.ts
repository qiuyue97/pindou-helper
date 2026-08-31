import type { Lab } from '../color/color';

export interface Box {
  width: number;
  height: number;
  pad: number;
}

export function planeScale(points: Lab[], box: Box) {
  const extent = points.reduce((m, p) => Math.max(m, Math.abs(p[1]), Math.abs(p[2])), 0);
  const radius = Math.max(extent, 10);
  const half = Math.min(box.width, box.height) / 2 - box.pad;
  const cx = box.width / 2;
  const cy = box.height / 2;

  return {
    radius,
    toScreen(lab: Lab) {
      return {
        x: cx + (lab[1] / radius) * half,
        y: cy - (lab[2] / radius) * half,
      };
    },
  };
}

export function lightnessScale(box: Box) {
  const top = box.pad;
  const usable = box.height - box.pad * 2;
  return {
    toY(L: number) {
      return top + ((100 - L) / 100) * usable;
    },
  };
}

export function orbitScale(projected: { x: number; y: number }[], box: Box) {
  const extent = projected.reduce((m, p) => Math.max(m, Math.abs(p.x), Math.abs(p.y)), 0);
  const radius = Math.max(extent, 10);
  const half = Math.min(box.width, box.height) / 2 - box.pad;
  const cx = box.width / 2;
  const cy = box.height / 2;

  return {
    toScreen(p: { x: number; y: number }) {
      return { x: cx + (p.x / radius) * half, y: cy - (p.y / radius) * half };
    },
  };
}

/**
 * Walk from `from` towards `to` and stop at the last point still inside the box
 * shrunk by `inset`. Used to keep axis labels on screen when the plot is zoomed
 * past the canvas edge — the label slides along its own axis instead of
 * disappearing. Returns `to` unchanged when it is already inside.
 */
export function clampSegmentToBox(
  from: { x: number; y: number },
  to: { x: number; y: number },
  box: Box,
  inset: number,
): { x: number; y: number } {
  const lo = { x: inset, y: inset };
  const hi = { x: box.width - inset, y: box.height - inset };
  const d = { x: to.x - from.x, y: to.y - from.y };

  let tMax = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = d[axis];
    if (Math.abs(delta) < 1e-9) continue; // parallel to this pair of edges
    const t1 = (lo[axis] - from[axis]) / delta;
    const t2 = (hi[axis] - from[axis]) / delta;
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  const t = Math.min(1, Math.max(0, tMax));
  return { x: from.x + d.x * t, y: from.y + d.y * t };
}
