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
  const [rect, setRect] = useState<Rect>(guess.rect as Rect);
  const [rows, setRows] = useState(guess.rows);
  const [cols, setCols] = useState(guess.cols);
  const [blanks, setBlanks] = useState(false);
  const [palette, setPalette] = useState<CandidateSet>('221');
  const drag = useRef<Corner | null>(null);

  // 原图。它同时是这个界面的底图和后面裁格子的素材。
  //
  // 放 state 里，不放 ref 里：画布那个 effect 得靠它当依赖。原来是塞进 ref 再
  // 强制重渲染一次，可 effect 的依赖是 [rect, rows, cols]，重渲染并不会让它重跑
  // ——于是底图**永远不画**，屏幕上只有一片绿网格，除非用户碰巧拖了一下角点。
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let alive = true;
    const im = new Image();
    im.onload = () => {
      if (alive) setImg(im);
    };
    im.onerror = () => {
      if (alive) setGone(true);
    };
    im.src = `/api/sheets/${guess.id}/image`;
    return () => {
      alive = false;
    };
  }, [guess.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

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
  }, [img, rect, rows, cols]);

  /** 图像像素 / 屏幕像素。canvas 被 CSS 缩放过，比例要从实际尺寸算。 */
  function scaleOf(el: HTMLCanvasElement): number {
    const box = el.getBoundingClientRect();
    return box.width ? el.width / box.width : 1;
  }

  /** 屏幕坐标 → 图像坐标。 */
  function localPoint(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const box = e.currentTarget.getBoundingClientRect();
    const kx = box.width ? e.currentTarget.width / box.width : 1;
    const ky = box.height ? e.currentTarget.height / box.height : 1;
    return [(e.clientX - box.left) * kx, (e.clientY - box.top) * ky];
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const [ix, iy] = localPoint(e);
    // 命中半径是**屏幕**像素（手指/鼠标的精度是屏幕上的事），而 hitCorner 在
    // **图像**空间比距离，所以必须跟着缩放比一起换算。
    //
    // 不换算的后果：一张 4096px 宽的图显示成 900px，缩放比 4.55，22 图像像素只
    // 相当于 4.9 个屏幕像素——用户得精确点在角上 5 像素内，图越大越拖不动。
    const radius = (e.pointerType === 'touch' ? HIT_TOUCH : HIT_MOUSE) * scaleOf(e.currentTarget);
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
      {gone && <p className="error">原图已不存在，没法框选。请重新上传。</p>}
      {!img && !gone && <p className="muted">正在载入原图…</p>}
      <canvas
        ref={canvasRef}
        aria-label="网格范围"
        width={guess.width}
        height={guess.height}
        // 不加 touchAction，手指一拖就变成滚页面而不是拖角。
        //
        // maxWidth 按图片比例换算出「高度不超过 70vh」的宽度：一张 4096x6044 的
        // 图按 width:100% 铺开有两千多像素高，四个角点和下面的行数/列数/开始识别
        // 全在屏幕外，用户看到的就是一整屏网格、点哪都没反应。用 maxWidth 而不是
        // maxHeight 是为了让缩放保持**等比**——加了 object-fit 会出现留白边，
        // 指针坐标换算就得跟着算letterbox，没必要。
        style={{
          touchAction: 'none',
          width: '100%',
          height: 'auto',
          maxWidth: `calc(70vh * ${guess.width / guess.height})`,
        }}
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
