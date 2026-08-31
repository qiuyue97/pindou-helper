import type { EffectiveColor } from './catalog';
import { deltaE76, type Lab } from './color';

export interface DebugRow {
  code: string;
  distance: number;
}

export function euclideanRanking(sampleLab: Lab, candidates: EffectiveColor[]): DebugRow[] {
  return candidates
    .map((c) => ({ code: c.code, distance: deltaE76(sampleLab, c.lab) }))
    .sort((a, b) => a.distance - b.distance);
}

type Mat3 = [number, number, number, number, number, number, number, number, number];

function covariance(points: Lab[]): Mat3 {
  const n = points.length;
  const mean: Lab = [0, 0, 0];
  for (const p of points) {
    mean[0] += p[0];
    mean[1] += p[1];
    mean[2] += p[2];
  }
  mean[0] /= n;
  mean[1] /= n;
  mean[2] /= n;

  const c: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i * 3 + j]! += d[i]! * d[j]!;
  }
  for (let i = 0; i < 9; i++) c[i]! /= n;
  c[0]! += 1e-6;
  c[4]! += 1e-6;
  c[8]! += 1e-6;
  return c;
}

function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = 1 / det;
  return [
    A * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    C * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}

export function mahalanobisRanking(sampleLab: Lab, candidates: EffectiveColor[]): DebugRow[] {
  const inv = invert3(covariance(candidates.map((c) => c.lab)));
  return candidates
    .map((c) => {
      const d = [sampleLab[0] - c.lab[0], sampleLab[1] - c.lab[1], sampleLab[2] - c.lab[2]];
      let q = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) q += d[i]! * inv[i * 3 + j]! * d[j]!;
      return { code: c.code, distance: Math.sqrt(Math.max(0, q)) };
    })
    .sort((a, b) => a.distance - b.distance);
}
