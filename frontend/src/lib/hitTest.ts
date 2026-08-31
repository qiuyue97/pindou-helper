export interface ScreenPoint {
  code: string;
  x: number;
  y: number;
}

/** Nearest plotted point to (x, y) within `radius` pixels, or null. */
export function nearestPoint(
  points: readonly ScreenPoint[],
  x: number,
  y: number,
  radius: number,
): ScreenPoint | null {
  let best: ScreenPoint | null = null;
  let bestDist = radius;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
