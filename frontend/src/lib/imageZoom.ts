/**
 * Pan/zoom for the image viewer.
 *
 * Zooming is about the image's own centre, which the CSS does for us: the img
 * carries `transform-origin: center` and `transform: translate(x,y) scale(s)`,
 * so scaling grows it about its middle and the translation is pure panning.
 *
 * An earlier version anchored the zoom on the cursor. That needs the cursor in
 * the image's untransformed coordinate space, but the image is centred inside
 * the box by `place-items: center`, so cursor-from-container coordinates were
 * off by the centring gap — the picture drifted further away the more you
 * zoomed. Centre-based zoom removes that mismatch entirely.
 */
export interface Transform {
  scale: number;
  /** Translation in container pixels, applied after the scale. */
  x: number;
  y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 12;

export const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Zoom about the image's centre. */
export function zoomBy(t: Transform, factor: number): Transform {
  const scale = clampScale(t.scale * factor);
  // Back at 1:1 the image fits again, so any leftover pan would strand it off
  // to one side with empty space beside it.
  if (scale === MIN_SCALE) return IDENTITY;
  return { ...t, scale };
}

export function panBy(t: Transform, dx: number, dy: number): Transform {
  if (t.scale === MIN_SCALE) return t; // 没放大就没有可平移的余地
  return { ...t, x: t.x + dx, y: t.y + dy };
}

export function cssTransform(t: Transform): string {
  return `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
}

/** Two-finger gesture, measured in container coordinates. */
export interface Pinch {
  /** Distance between the two fingers. */
  dist: number;
  /** Point midway between them. */
  mid: { x: number; y: number };
}

export function pinchOf(a: { x: number; y: number }, b: { x: number; y: number }): Pinch {
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

/**
 * Advance a pinch: scale by how much the fingers spread, and pan by how far the
 * gesture's midpoint travelled. Doing both is what makes it feel right —
 * pinching while sliding should move the image too, not just resize it.
 */
export function applyPinch(t: Transform, prev: Pinch, next: Pinch): Transform {
  // Fingers landing on the same spot would divide by zero.
  if (prev.dist <= 0) return t;
  const zoomed = zoomBy(t, next.dist / prev.dist);
  if (zoomed.scale === MIN_SCALE) return zoomed;
  return panBy(zoomed, next.mid.x - prev.mid.x, next.mid.y - prev.mid.y);
}
