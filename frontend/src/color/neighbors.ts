import type { EffectiveColor } from './catalog';
import { deltaE00, type Lab } from './color';

interface PlotOpts {
  topK?: number;
  perAxis?: number;
  cap?: number;
}

export function selectPlotSet(
  sampleLab: Lab,
  candidates: EffectiveColor[],
  opts: PlotOpts = {},
): EffectiveColor[] {
  const topK = opts.topK ?? 5;
  const perAxis = opts.perAxis ?? 3;
  const cap = opts.cap ?? 12;

  const byDe = [...candidates].sort(
    (a, b) => deltaE00(sampleLab, a.lab) - deltaE00(sampleLab, b.lab),
  );
  const nearestOnAxis = (axis: 0 | 1 | 2) =>
    [...candidates]
      .sort(
        (a, b) =>
          Math.abs(a.lab[axis] - sampleLab[axis]) - Math.abs(b.lab[axis] - sampleLab[axis]),
      )
      .slice(0, perAxis);

  const picked = new Map<string, EffectiveColor>();
  const add = (c: EffectiveColor) => {
    if (!picked.has(c.code)) picked.set(c.code, c);
  };

  const core = byDe.slice(0, topK);
  core.forEach(add);
  nearestOnAxis(0).forEach(add);
  nearestOnAxis(1).forEach(add);
  nearestOnAxis(2).forEach(add);

  let chosen = [...picked.values()];
  if (chosen.length > cap) {
    const keep = new Map<string, EffectiveColor>(core.map((c) => [c.code, c]));
    for (const c of byDe) {
      if (keep.size >= cap) break;
      if (picked.has(c.code)) keep.set(c.code, c);
    }
    chosen = [...keep.values()];
  }

  return chosen.sort((a, b) => deltaE00(sampleLab, a.lab) - deltaE00(sampleLab, b.lab));
}

export interface Projected {
  x: number;
  y: number;
  depth: number;
}

export function project3d(lab: Lab, azimuthDeg: number, elevationDeg: number): Projected {
  const L = lab[0] - 50;
  const a = lab[1];
  const b = lab[2];
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;

  const x = a * Math.cos(az) + b * Math.sin(az);
  const planarDepth = -a * Math.sin(az) + b * Math.cos(az);

  const y = L * Math.cos(el) - planarDepth * Math.sin(el);
  const depth = L * Math.sin(el) + planarDepth * Math.cos(el);

  return { x, y, depth };
}
