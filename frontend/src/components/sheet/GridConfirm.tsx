import { useCallback, useEffect, useRef, useState } from 'react';
import type { SheetGuess } from '../../api/types';
import type { CandidateSet } from '../../color/match';
import {
  HIT_MOUSE,
  HIT_TOUCH,
  SNAP_TOL,
  ZOOM_MAX,
  ZOOM_MIN,
  type Corner,
  type Rect,
  type View,
  corners,
  fitView,
  hitCorner,
  moveCorner,
  snap,
  toImage,
  toScreen,
  zoomAt,
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
 *
 * 画布是一个**固定大小的取景框**，图片经 `view`（缩放 + 平移）画进去。这样一来：
 *
 *   - 所有叠加层都按屏幕像素画。画布坐标系原来就是图像坐标系，一张 3492px 宽的
 *     图显示成 555px，2 像素的框线到屏幕上只剩 0.3 像素——用户报的「找不到网格
 *     在哪」就是这么来的。
 *   - 命中半径也直接是屏幕像素，不必再按缩放比换算。
 *   - 手机上能捏合放大去对准角点。一张 68x68 的图整屏显示时一格才 8 像素，
 *     手指根本点不准。
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
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 框可以超出图片边界，**不夹**。实测过一张 3492x3791 的图：检测给出的框从
  // -22 到 3514，格距 52.00 干干净净，每一格的中心都还落在图内，图片最外圈 12px
  // 是纯白边距——那 22px 就是最外一圈的半格留白，框是对的。夹回去会把格距压成
  // 51.35，最后一格的中心偏掉 44px，将近一整格，采样直接废掉。
  //
  // 之所以以前看起来「右边那条线不见了」，是因为画布本身就是图片，图外没有地方
  // 可画。现在画布是个更大的取景框，图外是灰底，越界的线看得清清楚楚。
  const [rect, setRect] = useState<Rect>(guess.rect as Rect);
  const [rows, setRows] = useState(guess.rows);
  const [cols, setCols] = useState(guess.cols);
  const [blanks, setBlanks] = useState(false);
  const [palette, setPalette] = useState<CandidateSet>('221');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [gone, setGone] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 });
  /** 整张图刚好放下时的倍率。缩放上下限都相对它，用户永远缩不到比「适应」更小。 */
  const base = fitView(guess.width, guess.height, box.w, box.h).scale;

  const fit = useCallback(() => {
    setView(fitView(guess.width, guess.height, box.w, box.h));
  }, [guess.width, guess.height, box.w, box.h]);

  // 原图。它同时是这个界面的底图和后面裁格子的素材。
  //
  // 放 state 里，不放 ref 里：画布那个 effect 得靠它当依赖。原来是塞进 ref 再
  // 强制重渲染一次，可 effect 的依赖里没有它，重渲染并不会让它重跑——底图于是
  // **永远不画**，屏幕上只有一片绿网格。
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

  // 取景框的实际大小。窗口一变（转屏、缩窗口）就得重新算。
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 图一到、取景框一有尺寸就适应一次。之后是用户自己缩放平移，不再自动动它。
  const fitted = useRef(false);
  useEffect(() => {
    if (!img || !box.w || fitted.current) return;
    fitted.current = true;
    fit();
  }, [img, box.w, fit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // 背板按设备像素分配，再把坐标系缩回 CSS 像素：下面所有的线宽、半径都是
    // 屏幕上看到的那个数，高分屏上也清晰。
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(box.w * dpr));
    canvas.height = Math.max(1, Math.round(box.h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);

    if (img) {
      ctx.drawImage(img, view.ox, view.oy, guess.width * view.scale, guess.height * view.scale);
    }

    const [sx0, sy0] = toScreen(rect[0], rect[1], view);
    const [sx1, sy1] = toScreen(rect[2], rect[3], view);

    if (rows > 0 && cols > 0) {
      ctx.strokeStyle = 'rgba(46,160,67,0.45)';
      ctx.lineWidth = 1;
      const step = Math.max(1, Math.round(Math.max(rows, cols) / GUIDE_LINES));
      for (let j = 0; j <= cols; j += step) {
        const x = sx0 + ((sx1 - sx0) * j) / cols;
        ctx.beginPath();
        ctx.moveTo(x, sy0);
        ctx.lineTo(x, sy1);
        ctx.stroke();
      }
      for (let i = 0; i <= rows; i += step) {
        const y = sy0 + ((sy1 - sy0) * i) / rows;
        ctx.beginPath();
        ctx.moveTo(sx0, y);
        ctx.lineTo(sx1, y);
        ctx.stroke();
      }
    }

    // 白衬 + 绿线画两遍：图纸本身花花绿绿，单一条绿线压上去找不着
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 5;
    ctx.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
    ctx.strokeStyle = '#2ea043';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    for (const [ix, iy] of corners(rect)) {
      const [cx, cy] = toScreen(ix, iy, view);
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#2ea043';
      ctx.fill();
      ctx.stroke();
    }
  }, [img, rect, rows, cols, view, box.w, box.h, guess.width, guess.height]);

  /** 屏幕坐标（CSS 像素，相对取景框左上角）。 */
  function local(e: { clientX: number; clientY: number }, el: HTMLElement): [number, number] {
    const b = el.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  }

  // --- 指针：一根手指拖角或平移，两根捏合缩放 ---

  const pointers = useRef(new Map<number, [number, number]>());
  const drag = useRef<Corner | null>(null);
  const pan = useRef<[number, number] | null>(null);
  const pinch = useRef<number | null>(null);

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = local(e, e.currentTarget);
    pointers.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (pointers.current.size === 2) {
      // 第二根手指落下：停掉拖角/平移，进入捏合
      drag.current = null;
      pan.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a![0] - b![0], a![1] - b![1]);
      return;
    }

    // 命中判定直接在屏幕空间做，半径就是手指/鼠标的精度，不用再换算
    const [sx0, sy0] = toScreen(rect[0], rect[1], view);
    const [sx1, sy1] = toScreen(rect[2], rect[3], view);
    const radius = e.pointerType === 'touch' ? HIT_TOUCH : HIT_MOUSE;
    const corner = hitCorner([sx0, sy0, sx1, sy1], p[0], p[1], radius);
    if (corner === null) pan.current = p;
    else drag.current = corner;
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e, e.currentTarget);
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size >= 2 && pinch.current !== null) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a![0] - b![0], a![1] - b![1]);
      const from = pinch.current;
      if (d > 0 && from > 0) {
        const mx = (a![0] + b![0]) / 2;
        const my = (a![1] + b![1]) / 2;
        setView((v) => zoomAt(v, mx, my, d / from, base * ZOOM_MIN, base * ZOOM_MAX));
      }
      pinch.current = d;
      return;
    }

    if (drag.current !== null) {
      const [ix, iy] = toImage(p[0], p[1], view);
      // 吸附容差给的是**屏幕**像素，换算成图像像素：放大之后吸附也该跟着变细，
      // 否则缩到很小时一碰就吸，放大之后又完全吸不上
      const tol = SNAP_TOL / (view.scale || 1);
      const corner = drag.current;
      setRect((r) => moveCorner(r, corner, snap(ix, guess.snap_x, tol), snap(iy, guess.snap_y, tol)));
      return;
    }

    if (pan.current) {
      setView((v) => ({ ...v, ox: v.ox + p[0] - prev[0], oy: v.oy + p[1] - prev[1] }));
    }
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    drag.current = null;
    pan.current = null;
    if (pointers.current.size < 2) pinch.current = null;
  }

  // 滚轮缩放。React 的 onWheel 挂的是被动监听，preventDefault 无效（页面会跟着
  // 一起滚），所以自己挂一个非被动的。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = canvas.getBoundingClientRect();
      const px = e.clientX - b.left;
      const py = e.clientY - b.top;
      setView((v) =>
        zoomAt(v, px, py, Math.exp(-e.deltaY / 400), base * ZOOM_MIN, base * ZOOM_MAX),
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [base]);

  function zoomBy(factor: number) {
    setView((v) => zoomAt(v, box.w / 2, box.h / 2, factor, base * ZOOM_MIN, base * ZOOM_MAX));
  }

  const ready = rows > 0 && cols > 0;

  return (
    <div className="grid-confirm">
      {guess.source === 'manual' && (
        <p className="muted">没有自动找到网格。请拖动四个角框住豆阵，并填写行数和列数。</p>
      )}
      {gone && <p className="error">原图已不存在，没法框选。请重新上传。</p>}
      {!img && !gone && <p className="muted">正在载入原图…</p>}

      <div className="grid-confirm-stage" ref={boxRef}>
        <canvas
          ref={canvasRef}
          aria-label="网格范围"
          // 不加 touchAction，手指一拖就变成滚页面而不是拖角/平移
          style={{ touchAction: 'none', width: '100%', height: '100%' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>

      <div className="grid-confirm-zoom">
        <button type="button" aria-label="放大" onClick={() => zoomBy(1.4)}>
          ＋
        </button>
        <button type="button" aria-label="缩小" onClick={() => zoomBy(1 / 1.4)}>
          －
        </button>
        <button type="button" onClick={fit}>
          适应
        </button>
        <span className="muted">拖角点对准豆阵；空白处拖动可平移，滚轮或双指捏合缩放</span>
      </div>

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
          onClick={() => onConfirm({ rect: [...rect], rows, cols, has_blanks: blanks, palette })}
        >
          开始识别
        </button>
      </div>
    </div>
  );
}
