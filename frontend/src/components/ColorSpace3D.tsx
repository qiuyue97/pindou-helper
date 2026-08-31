import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { EffectiveColor } from '../color/catalog';
import { deltaE00, hexToLab } from '../color/color';
import { project3d, selectPlotSet } from '../color/neighbors';
import { orbitScale } from '../lib/plotGeometry';

const SIZE = 320;
const DEFAULT_AZ = 35;
const DEFAULT_EL = 20;

export default function ColorSpace3D({
  sampleHex,
  candidates,
}: {
  sampleHex: string;
  candidates: EffectiveColor[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [az, setAz] = useState(DEFAULT_AZ);
  const [el, setEl] = useState(DEFAULT_EL);

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
      ...plot.map((c) => ({ hex: c.hex, lab: c.lab, sample: false })),
      { hex: sampleHex, lab: sampleLab, sample: true },
    ].map((n) => ({ ...n, p: project3d(n.lab, az, el) }));

    const scale = orbitScale(
      nodes.map((n) => n.p),
      { width: SIZE, height: SIZE, pad: 28 },
    );
    const depths = nodes.map((n) => n.p.depth);
    const lo = Math.min(...depths);
    const hi = Math.max(...depths);
    const norm = (d: number) => (hi === lo ? 0.5 : (d - lo) / (hi - lo));

    ctx.clearRect(0, 0, SIZE, SIZE);

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

    for (const n of [...nodes].sort((a, b) => a.p.depth - b.p.depth)) {
      const pt = scale.toScreen(n.p);
      const r = (n.sample ? 8 : 5) + 4 * norm(n.p.depth);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `#${n.hex}`;
      ctx.fill();
      ctx.strokeStyle = '#1c1c1a';
      ctx.lineWidth = n.sample ? 3 : 1;
      ctx.stroke();
    }
  }, [sampleHex, sampleLab, plot, az, el]);

  function onDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) return;
    setAz((a) => a + (e.clientX - d.x) * 0.5);
    setEl((v) => Math.min(80, Math.max(-80, v - (e.clientY - d.y) * 0.5)));
    drag.current = { x: e.clientX, y: e.clientY };
  }
  const onUp = () => {
    drag.current = null;
  };

  return (
    <div className="space3d">
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
      />
      <div className="space3d-controls">
        <span className="muted" data-testid="view-angles">
          方位 {Math.round(az)}° / 俯仰 {Math.round(el)}°
        </span>
        <button
          type="button"
          onClick={() => {
            setAz(DEFAULT_AZ);
            setEl(DEFAULT_EL);
          }}
        >
          重置视角
        </button>
      </div>
    </div>
  );
}
