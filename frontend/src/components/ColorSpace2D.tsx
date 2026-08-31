import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { EffectiveColor } from '../color/catalog';
import { deltaE00, hexToLab, type Lab } from '../color/color';
import { selectPlotSet } from '../color/neighbors';
import { nearestPoint, type ScreenPoint } from '../lib/hitTest';
import { lightnessScale, planeScale, zoomAbout } from '../lib/plotGeometry';

const PLANE = 280;
const STRIP_W = 60;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

export default function ColorSpace2D({
  sampleHex,
  candidates,
}: {
  sampleHex: string;
  candidates: EffectiveColor[];
}) {
  const planeRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const hits = useRef<ScreenPoint[]>([]);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);

  const sampleLab = useMemo(() => hexToLab(sampleHex), [sampleHex]);
  const plot = useMemo(
    () => selectPlotSet(sampleLab, candidates, { topK: 5, perAxis: 3, cap: 12 }),
    [sampleLab, candidates],
  );

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // React registers onWheel as a PASSIVE listener, so preventDefault() inside a
  // React handler is ignored and the page scrolls behind the canvas. Bind it
  // natively with { passive: false } instead.
  useEffect(() => {
    const canvas = planeRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const next = e.deltaY < 0 ? z * 1.2 : z / 1.2;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const canvas = planeRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const box = { width: PLANE, height: PLANE, pad: 24 };
    const labs: Lab[] = [sampleLab, ...plot.map((c) => c.lab)];
    const base = planeScale(labs, box);
    // Anchor the zoom on the sampled colour so it never drifts off-canvas;
    // panning still moves the whole plot afterwards.
    const anchor = base.toScreen(sampleLab);
    const toScreen = (lab: Lab) => {
      const p = zoomAbout(base.toScreen(lab), anchor, zoom);
      return { x: p.x + pan.x, y: p.y + pan.y };
    };

    ctx.clearRect(0, 0, PLANE, PLANE);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, PLANE, PLANE);
    ctx.clip();

    const origin = toScreen([50, 0, 0]);
    ctx.strokeStyle = '#e3e3df';
    ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, (PLANE / 2 - box.pad) * f * zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, origin.y);
    ctx.lineTo(PLANE, origin.y);
    ctx.moveTo(origin.x, 0);
    ctx.lineTo(origin.x, PLANE);
    ctx.stroke();

    const s = toScreen(sampleLab);

    const nearest = [...plot]
      .sort((a, b) => deltaE00(sampleLab, a.lab) - deltaE00(sampleLab, b.lab))
      .slice(0, 3);
    ctx.strokeStyle = '#9a9a94';
    ctx.fillStyle = '#6b6b66';
    ctx.font = '11px system-ui, sans-serif';
    for (const c of nearest) {
      const p = toScreen(c.lab);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillText(deltaE00(sampleLab, c.lab).toFixed(1), (s.x + p.x) / 2 + 3, (s.y + p.y) / 2 - 3);
    }

    const found: ScreenPoint[] = [];
    for (const c of plot) {
      const p = toScreen(c.lab);
      found.push({ code: c.code, x: p.x, y: p.y });
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = `#${c.hex}`;
      ctx.fill();
      ctx.strokeStyle = '#1c1c1a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    hits.current = found;

    ctx.beginPath();
    ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = `#${sampleHex}`;
    ctx.fill();
    ctx.strokeStyle = '#1c1c1a';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }, [sampleHex, sampleLab, plot, zoom, pan]);

  useEffect(() => {
    const canvas = stripRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const box = { width: STRIP_W, height: PLANE, pad: 24 };
    const scale = lightnessScale(box);
    ctx.clearRect(0, 0, STRIP_W, PLANE);

    ctx.strokeStyle = '#e3e3df';
    ctx.beginPath();
    ctx.moveTo(STRIP_W / 2, box.pad);
    ctx.lineTo(STRIP_W / 2, PLANE - box.pad);
    ctx.stroke();

    for (const c of plot) {
      const y = scale.toY(c.lab[0]);
      ctx.fillStyle = `#${c.hex}`;
      ctx.fillRect(STRIP_W / 2 - 9, y - 3, 18, 6);
      ctx.strokeStyle = '#1c1c1a';
      ctx.lineWidth = 1;
      ctx.strokeRect(STRIP_W / 2 - 9, y - 3, 18, 6);
    }

    const y = scale.toY(sampleLab[0]);
    ctx.fillStyle = `#${sampleHex}`;
    ctx.fillRect(STRIP_W / 2 - 14, y - 4, 28, 8);
    ctx.strokeStyle = '#1c1c1a';
    ctx.lineWidth = 3;
    ctx.strokeRect(STRIP_W / 2 - 14, y - 4, 28, 8);
  }, [sampleHex, sampleLab, plot]);

  function onMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const d = drag.current;
    if (d) {
      setPan((p) => ({ x: p.x + (e.clientX - d.x), y: p.y + (e.clientY - d.y) }));
      drag.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const hit = nearestPoint(hits.current, x, y, 12);
    setHover(hit ? { code: hit.code, x: hit.x, y: hit.y } : null);
  }

  return (
    <div className="space2d">
      <div className="canvases">
        <div className="plane-wrap">
          <canvas
            ref={planeRef}
            width={PLANE}
            height={PLANE}
            aria-label="a*–b* 平面"
            style={{ touchAction: 'none', cursor: drag.current ? 'grabbing' : 'crosshair' }}
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={onMove}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerLeave={() => {
              drag.current = null;
              setHover(null);
            }}
          />
          {hover && (
            <span
              className="point-label"
              role="tooltip"
              style={{ left: hover.x + 12, top: hover.y - 10 }}
            >
              {hover.code}
            </span>
          )}
        </div>
        <canvas ref={stripRef} width={STRIP_W} height={PLANE} aria-label="L* 明度" />
      </div>

      <div className="space2d-controls">
        <button type="button" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.4))}>
          放大
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.4))}>
          缩小
        </button>
        <button type="button" onClick={reset}>
          重置视图
        </button>
        <span className="muted" data-testid="plane-zoom">
          {zoom.toFixed(1)}×
        </span>
        <span className="muted">滚轮缩放，拖拽平移，悬停看色号</span>
      </div>

      <ul className="legend" aria-label="图中色号">
        {plot.map((c) => (
          <li key={c.code}>
            <span className="swatch" style={{ background: `#${c.hex}` }} />
            {c.code}
            <span className="muted"> ΔE {deltaE00(sampleLab, c.lab).toFixed(1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
