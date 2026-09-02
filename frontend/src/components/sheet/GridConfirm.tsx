import { useEffect, useRef, useState } from 'react';
import type { SheetGuess } from '../../api/types';
import type { CandidateSet } from '../../color/match';
import {
  HIT_MOUSE,
  HIT_TOUCH,
  SNAP_TOL,
  type Corner,
  type Rect,
  corners,
  hitCorner,
  moveCorner,
  snap,
} from '../../lib/sheetGeometry';

export interface Geometry {
  rect: number[];
  rows: number;
  cols: number;
  has_blanks: boolean;
  palette: CandidateSet;
}

/** 参考网格线画几条就够——104 条全画出来缩到屏幕上就是一片灰。 */
const GUIDE_LINES = 20;

/**
 * 拖四个角把网格框对准，然后开始识别。
 *
 * 四个角是**轴对齐矩形**的四角——拖一个角改的是 rect 的边界，不是自由四点透视。
 * 拖动时吸附到 `snap_x/snap_y` 里真实检测到的分隔线上。
 *
 * 检测失败不是错误：那时 snap 是空的、rows/cols 是 0，用户自己拖框填数字，
 * 之后走的是完全相同的代码——下游只吃 (rect, rows, cols, has_blanks)。
 */
export default function GridConfirm({
  guess,
  onConfirm,
  busy = false,
}: {
  guess: SheetGuess;
  onConfirm: (g: Geometry) => void;
  busy?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [rect, setRect] = useState<Rect>(guess.rect as Rect);
  const [rows, setRows] = useState(guess.rows);
  const [cols, setCols] = useState(guess.cols);
  const [blanks, setBlanks] = useState(false);
  const [palette, setPalette] = useState<CandidateSet>('221');
  const drag = useRef<Corner | null>(null);
  const [, force] = useState(0);

  // 原图。它同时是这个界面的底图和后面裁格子的素材。
  useEffect(() => {
    const im = new Image();
    im.src = `/api/sheets/${guess.id}/image`;
    im.onload = () => {
      imgRef.current = im;
      force((n) => n + 1);
    };
  }, [guess.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (imgRef.current) ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);

    const [x0, y0, x1, y1] = rect;
    ctx.strokeStyle = '#2ea043';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

    if (rows > 0 && cols > 0) {
      ctx.strokeStyle = 'rgba(46,160,67,0.35)';
      ctx.lineWidth = 1;
      const step = Math.max(1, Math.round(Math.max(rows, cols) / GUIDE_LINES));
      for (let j = 0; j <= cols; j += step) {
        const x = x0 + ((x1 - x0) * j) / cols;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
      }
      for (let i = 0; i <= rows; i += step) {
        const y = y0 + ((y1 - y0) * i) / rows;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      }
    }

    ctx.fillStyle = '#2ea043';
    for (const [cx, cy] of corners(rect)) {
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [rect, rows, cols]);

  /** 屏幕坐标 → 图像坐标。canvas 被 CSS 缩放过，比例要从实际尺寸算。 */
  function localPoint(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const box = e.currentTarget.getBoundingClientRect();
    const kx = box.width ? e.currentTarget.width / box.width : 1;
    const ky = box.height ? e.currentTarget.height / box.height : 1;
    return [(e.clientX - box.left) * kx, (e.clientY - box.top) * ky];
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const [ix, iy] = localPoint(e);
    const radius = e.pointerType === 'touch' ? HIT_TOUCH : HIT_MOUSE;
    const corner = hitCorner(rect, ix, iy, radius);
    if (corner === null) return;
    drag.current = corner;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (drag.current === null) return;
    const [ix, iy] = localPoint(e);
    setRect(
      moveCorner(
        rect,
        drag.current,
        snap(ix, guess.snap_x, SNAP_TOL),
        snap(iy, guess.snap_y, SNAP_TOL),
      ),
    );
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  const ready = rows > 0 && cols > 0;

  return (
    <div className="grid-confirm">
      {guess.source === 'manual' && (
        <p className="muted">没有自动找到网格。请拖动四个角框住豆阵，并填写行数和列数。</p>
      )}
      <canvas
        ref={canvasRef}
        aria-label="网格范围"
        width={guess.width}
        height={guess.height}
        // 不加这个，手指一拖就变成滚页面而不是拖角
        style={{ touchAction: 'none', width: '100%' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      <div className="grid-confirm-controls">
        <label>
          行数
          <input
            type="number"
            min={1}
            value={rows}
            onChange={(e) => setRows(Number(e.target.value))}
          />
        </label>
        <label>
          列数
          <input
            type="number"
            min={1}
            value={cols}
            onChange={(e) => setCols(Number(e.target.value))}
          />
        </label>
        <label>
          色卡
          <select value={palette} onChange={(e) => setPalette(e.target.value as CandidateSet)}>
            <option value="221">Mard-221</option>
            <option value="291">Mard-291</option>
          </select>
        </label>
        <label>
          {/* 白色的豆子和空格子在像素上分不开，没有阈值能可靠区分——只能问人 */}
          <input type="checkbox" checked={blanks} onChange={(e) => setBlanks(e.target.checked)} />
          有空格子（框里有没放豆子的格）
        </label>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() =>
            onConfirm({ rect: [...rect], rows, cols, has_blanks: blanks, palette })
          }
        >
          开始识别
        </button>
      </div>
    </div>
  );
}
