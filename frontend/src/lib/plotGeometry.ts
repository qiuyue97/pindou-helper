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
