/**
 * Where to put the magnifier so it is always fully visible.
 *
 * Preference is above the crosshair (a finger or cursor sits below it), but
 * near the top edge that would clip, so it flips underneath instead. Both
 * axes are clamped to the canvas as a last resort.
 */
export function loupePosition(
  x: number,
  y: number,
  canvas: { width: number; height: number },
  size: number,
  gap: number,
): { left: number; top: number } {
  const above = y - gap - size;
  const below = y + gap;

  let top: number;
  if (above >= 0) top = above;
  else if (below + size <= canvas.height) top = below;
  else top = above; // neither fits — clamp below decides

  const maxTop = Math.max(0, canvas.height - size);
  top = Math.min(maxTop, Math.max(0, top));

  const maxLeft = Math.max(0, canvas.width - size);
  const left = Math.min(maxLeft, Math.max(0, x - size / 2));

  return { left, top };
}
