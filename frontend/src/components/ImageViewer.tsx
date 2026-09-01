import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  IDENTITY,
  MIN_SCALE,
  type Pinch,
  type Transform,
  applyPinch,
  cssTransform,
  panBy,
  pinchOf,
  zoomBy,
} from '../lib/imageZoom';

const STEP = 1.4;
/** Two taps closer together than this count as a double tap. */
const DOUBLE_TAP_MS = 300;

/**
 * Zoomable, pannable image.
 *
 * Desktop: wheel to zoom, drag to pan, double-click to reset.
 * Touch: pinch to zoom, one finger to pan, double-tap to reset.
 *
 * `.viewer-box` sets `touch-action: none`, which hands us every touch — that is
 * what makes one-finger panning possible, but it also switches off the browser's
 * own pinch, so the two-finger gesture below is not optional.
 */
export default function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<Transform>(IDENTITY);

  /** Every finger/pen/mouse button currently down, by pointerId. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<Pinch | null>(null);
  const lastPan = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  // React registers wheel handlers as PASSIVE, so an onWheel prop cannot call
  // preventDefault and the page scrolls behind the dialog. Bind it natively.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setT((prev) => zoomBy(prev, e.deltaY < 0 ? STEP : 1 / STEP));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function local(e: { clientX: number; clientY: number }) {
    const rect = boxRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.set(e.pointerId, local(e));
    e.currentTarget.setPointerCapture(e.pointerId);

    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      // A second finger landed: switch from panning to pinching.
      pinch.current = pinchOf(pts[0]!, pts[1]!);
      lastPan.current = null;
      return;
    }

    if (pts.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        // Double-tap resets. onDoubleClick is unreliable under touch-action:none.
        setT(IDENTITY);
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
      lastPan.current = local(e);
    }
  }

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];

    if (pts.length >= 2) {
      const next = pinchOf(pts[0]!, pts[1]!);
      const prev = pinch.current;
      pinch.current = next;
      if (prev) setT((cur) => applyPinch(cur, prev, next));
      return;
    }

    const from = lastPan.current;
    if (!from) return;
    const to = local(e);
    lastPan.current = to;
    setT((cur) => panBy(cur, to.x - from.x, to.y - from.y));
  }

  function onUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) lastPan.current = null;
    else {
      // A finger lifted mid-pinch: carry on panning from the one still down.
      const [remaining] = [...pointers.current.values()];
      lastPan.current = remaining ?? null;
    }
  }

  return (
    <div className="viewer">
      <div className="viewer-controls">
        <button type="button" aria-label="放大" title="放大" onClick={() => setT((p) => zoomBy(p, STEP))}>
          <ZoomIn size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="缩小"
          title="缩小"
          onClick={() => setT((p) => zoomBy(p, 1 / STEP))}
        >
          <ZoomOut size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="还原" title="还原" onClick={() => setT(IDENTITY)}>
          <Maximize2 size={15} aria-hidden="true" />
        </button>
        <span className="muted" data-testid="zoom-level">
          {Math.round(t.scale * 100)}%
        </span>
      </div>

      <div
        ref={boxRef}
        className={`viewer-box${t.scale > MIN_SCALE ? ' is-zoomed' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => setT(IDENTITY)}
      >
        <img src={src} alt={alt} style={{ transform: cssTransform(t) }} draggable={false} />
      </div>
      <p className="muted viewer-hint">
        滚轮或双指捏合缩放，放大后可拖拽，双击 / 双指点两下还原
      </p>
    </div>
  );
}
