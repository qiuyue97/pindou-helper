import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { EffectiveColor } from '../color/catalog';
import { deltaE00, hexToLab, type Lab } from '../color/color';
import { project3d, selectPlotSet } from '../color/neighbors';
import { nearestPoint, type ScreenPoint } from '../lib/hitTest';
import { orbitScale } from '../lib/plotGeometry';

const SIZE = 320;
const DEFAULT_AZ = 35;
const DEFAULT_EL = 20;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
/** Half-length of each drawn axis, in Lab units. */
const AXIS = 60;

export default function ColorSpace3D({
  sampleHex,
  candidates,
}: {
  sampleHex: string;
  candidates: EffectiveColor[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const hits = useRef<ScreenPoint[]>([]);
  const [az, setAz] = useState(DEFAULT_AZ);
  const [el, setEl] = useState(DEFAULT_EL);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);

  const sampleLab = useMemo(() => hexToLab(sampleHex), [sampleHex]);
  const plot = useMemo(
    () => selectPlotSet(sampleLab, candidates, { topK: 5, perAxis: 3, cap: 12 }),
    [sampleLab, candidates],
  );

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const nodes = [
      ...plot.map((c) => ({ code: c.code, hex: c.hex, lab: c.lab, sample: false })),
      { code: '', hex: sampleHex, lab: sampleLab, sample: true },
    ].map((n) => ({ ...n, p: project3d(n.lab, az, el) }));

    const base = orbitScale(
      [...nodes.map((n) => n.p), { x: AXIS, y: AXIS }, { x: -AXIS, y: -AXIS }],
      { width: SIZE, height: SIZE, pad: 28 },
    );
    const c = SIZE / 2;
    const scale = {
      toScreen(p: { x: number; y: number }) {
        const q = base.toScreen(p);
        return { x: c + (q.x - c) * zoom, y: c + (q.y - c) * zoom };
      },
    };
    const depths = nodes.map((n) => n.p.depth);
    const lo = Math.min(...depths);
    const hi = Math.max(...depths);
    const norm = (d: number) => (hi === lo ? 0.5 : (d - lo) / (hi - lo));

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.clip();

    // Axes through the neutral point, so the orbit has a frame of reference.
    const axes: [string, [number, number, number], [number, number, number]][] = [
      ['L*', [50 - AXIS, 0, 0], [50 + AXIS, 0, 0]],
      ['a*', [50, -AXIS, 0], [50, AXIS, 0]],
      ['b*', [50, 0, -AXIS], [50, 0, AXIS]],
    ];
    ctx.font = '11px system-ui, sans-serif';
    for (const [label, from, to] of axes) {
      const a = scale.toScreen(project3d(from as Lab, az, el));
      const b = scale.toScreen(project3d(to as Lab, az, el));
      ctx.strokeStyle = '#d5d5cf';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = '#9a9a94';
      ctx.fillText(label, b.x + 3, b.y - 3);
    }

    const sample = nodes[nodes.length - 1]!;
    const sPt = scale.toScreen(sample.p);

    const nearest = [...plot]
      .sort((a, b) => deltaE00(sampleLab, a.lab) - deltaE00(sampleLab, b.lab))
      .slice(0, 3)
      .map((c) => scale.toScreen(project3d(c.lab, az, el)));
    ctx.strokeStyle = '#c9c9c3';
    ctx.lineWidth = 1;
    for (const p of nearest) {
      ctx.beginPath();
      ctx.moveTo(sPt.x, sPt.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    const found: ScreenPoint[] = [];
    for (const n of [...nodes].sort((a, b) => a.p.depth - b.p.depth)) {
      const pt = scale.toScreen(n.p);
      if (!n.sample) found.push({ code: n.code, x: pt.x, y: pt.y });
      const r = (n.sample ? 8 : 5) + 4 * norm(n.p.depth);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `#${n.hex}`;
      ctx.fill();
      ctx.strokeStyle = '#1c1c1a';
      ctx.lineWidth = n.sample ? 3 : 1;
      ctx.stroke();
    }
    hits.current = found;
    ctx.restore();
  }, [sampleHex, sampleLab, plot, az, el, zoom]);

  // Same passive-listener problem as the 2D plane: bind wheel natively.
  useEffect(() => {
    const canvas = ref.current;
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

  function onDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (d) {
      setAz((a) => a + (e.clientX - d.x) * 0.5);
      setEl((v) => Math.min(80, Math.max(-80, v - (e.clientY - d.y) * 0.5)));
      drag.current = { x: e.clientX, y: e.clientY };
      setHover(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = nearestPoint(hits.current, e.clientX - rect.left, e.clientY - rect.top, 12);
    setHover(hit ? { code: hit.code, x: hit.x, y: hit.y } : null);
  }
  const onUp = () => {
    drag.current = null;
  };

  return (
    <div className="space3d">
      <div className="plane-wrap">
        <canvas
          ref={ref}
          width={SIZE}
          height={SIZE}
          aria-label="CIELAB 三维视图"
          style={{ touchAction: 'none', cursor: 'grab' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => {
            onUp();
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
      <div className="space3d-controls">
        <span className="muted" data-testid="view-angles">
          方位 {Math.round(az)}° / 俯仰 {Math.round(el)}°
        </span>
        <button type="button" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.4))}>
          放大
        </button>
        <button type="button" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.4))}>
          缩小
        </button>
        <button
          type="button"
          onClick={() => {
            setAz(DEFAULT_AZ);
            setEl(DEFAULT_EL);
            setZoom(1);
          }}
        >
          重置视角
        </button>
        <span className="muted" data-testid="orbit-zoom">
          {zoom.toFixed(1)}×
        </span>
        <span className="muted">拖拽旋转，滚轮缩放，悬停看色号</span>
      </div>
    </div>
  );
}
