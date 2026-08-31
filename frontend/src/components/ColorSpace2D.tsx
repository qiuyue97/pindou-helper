import { useEffect, useMemo, useRef } from 'react';
import type { EffectiveColor } from '../color/catalog';
import { deltaE00, hexToLab, type Lab } from '../color/color';
import { selectPlotSet } from '../color/neighbors';
import { lightnessScale, planeScale } from '../lib/plotGeometry';

const PLANE = 280;
const STRIP_W = 60;

export default function ColorSpace2D({
  sampleHex,
  candidates,
}: {
  sampleHex: string;
  candidates: EffectiveColor[];
}) {
  const planeRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);

  const sampleLab = useMemo(() => hexToLab(sampleHex), [sampleHex]);
  const plot = useMemo(
    () => selectPlotSet(sampleLab, candidates, { topK: 5, perAxis: 3, cap: 12 }),
    [sampleLab, candidates],
  );

  useEffect(() => {
    const canvas = planeRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const box = { width: PLANE, height: PLANE, pad: 24 };
    const labs: Lab[] = [sampleLab, ...plot.map((c) => c.lab)];
    const scale = planeScale(labs, box);

    ctx.clearRect(0, 0, PLANE, PLANE);

    const origin = scale.toScreen([50, 0, 0]);
    ctx.strokeStyle = '#e3e3df';
    ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, (PLANE / 2 - box.pad) * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(box.pad, origin.y);
    ctx.lineTo(PLANE - box.pad, origin.y);
    ctx.moveTo(origin.x, box.pad);
    ctx.lineTo(origin.x, PLANE - box.pad);
    ctx.stroke();

    const s = scale.toScreen(sampleLab);

    const nearest = [...plot]
      .sort((a, b) => deltaE00(sampleLab, a.lab) - deltaE00(sampleLab, b.lab))
      .slice(0, 3);
    ctx.strokeStyle = '#9a9a94';
    ctx.fillStyle = '#6b6b66';
    ctx.font = '11px system-ui, sans-serif';
    for (const c of nearest) {
      const p = scale.toScreen(c.lab);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillText(deltaE00(sampleLab, c.lab).toFixed(1), (s.x + p.x) / 2 + 3, (s.y + p.y) / 2 - 3);
    }

    for (const c of plot) {
      const p = scale.toScreen(c.lab);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = `#${c.hex}`;
      ctx.fill();
      ctx.strokeStyle = '#1c1c1a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = `#${sampleHex}`;
    ctx.fill();
    ctx.strokeStyle = '#1c1c1a';
    ctx.lineWidth = 3;
    ctx.stroke();
  }, [sampleHex, sampleLab, plot]);

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

  return (
    <div className="space2d">
      <div className="canvases">
        <canvas ref={planeRef} width={PLANE} height={PLANE} aria-label="a*–b* 平面" />
        <canvas ref={stripRef} width={STRIP_W} height={PLANE} aria-label="L* 明度" />
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
