import { useCallback, useEffect, useRef, useState } from 'react';
import type { SheetGuess } from '../../api/types';
import type { CandidateSet } from '../../color/match';
import { aspectOf, fitBox, moveBox, reaspect, resizeCorner } from '../../lib/cropBox';
import {
  HIT_MOUSE,
  HIT_TOUCH,
  ZOOM_MAX,
  ZOOM_MIN,
  type Corner,
  type Rect,
  type View,
  corners,
  fitView,
  hitCorner,
  loupeAnchor,
  loupeSpan,
  toImage,
  toScreen,
  zoomAt,
} from '../../lib/sheetGeometry';

export interface GenerateSpec {
  rect: number[];
  rows: number;
  cols: number;
  palette: CandidateSet;
  style: 'slic' | 'dpid';
  clean: boolean;
}

/** 参考网格线画几条就够——一百多条缩到屏幕上就是一片灰。 */
const GUIDE_LINES = 24;
/** 框外面压多暗。够看清「选的是哪一块」，又还看得见外面是什么。 */
const DIM = 'rgba(0,0,0,0.55)';
/** 放大镜方框边长（CSS 像素）。 */
const LOUPE = 132;

/**
 * 框一块照片，定好豆阵尺寸，生成图纸。
 *
 * 和 GridConfirm（识别那边）**长得像但不是一回事**：
 *
 *   识别的框   四个角各自独立，允许超出图片（生成器导出的图最外圈常有半格留白）
 *   这里的框   比例**锁死**成 cols:rows，而且不能超出图片——超出去没有像素可切。
 *              比例一歪豆子就被拉长，那是成品摆出来之前看不出来的错误。
 *
 * 框外面压暗 + 半透明：用户要一眼看出「我选的是哪一块」，同时还得看得见外面是
 * 什么，好判断框有没有框歪。
 *
 * 取景框、缩放平移、角点命中块、放大镜这几样和 GridConfirm 同一套做法——包括
 * 手机上「画布 pan-y 让给页面滚动、角点命中块自己 touch-action: none」那条。
 */
export default function CropConfirm({
  guess,
  onConfirm,
  busy = false,
}: {
  guess: SheetGuess;
  onConfirm: (spec: GenerateSpec) => void;
  busy?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);

  const [rows, setRows] = useState(50);
  const [cols, setCols] = useState(50);
  const [palette, setPalette] = useState<CandidateSet>('221');
  const [style, setStyle] = useState<'slic' | 'dpid'>('slic');
  const [clean, setClean] = useState(true);

  const [rect, setRect] = useState<Rect>(() =>
    fitBox(guess.width, guess.height, aspectOf(50, 50)),
  );
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [gone, setGone] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, ox: 0, oy: 0 });
  const [loupe, setLoupe] = useState<[number, number] | null>(null);
  const base = fitView(guess.width, guess.height, box.w, box.h).scale;
  const aspect = aspectOf(rows, cols);

  const fit = useCallback(() => {
    setView(fitView(guess.width, guess.height, box.w, box.h));
  }, [guess.width, guess.height, box.w, box.h]);

  useEffect(() => {
    let alive = true;
    const im = new Image();
    im.onload = () => alive && setImg(im);
    im.onerror = () => alive && setGone(true);
    im.src = `/api/sheets/${guess.id}/image`;
    return () => {
      alive = false;
    };
  }, [guess.id]);

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

  const fitted = useRef(false);
  useEffect(() => {
    if (!img || !box.w || fitted.current) return;
    fitted.current = true;
    fit();
  }, [img, box.w, fit]);

  // 行列数一改，框就换成新比例（中心不动）。不这样的话框还是老比例，切出来的
  // 豆子全被拉长——而那是成品摆出来之前看不出来的错误。
  useEffect(() => {
    setRect((r) => reaspect(r, aspect, guess.width, guess.height));
  }, [aspect, guess.width, guess.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
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

    // 框外面压暗。四条带子围着框画，而不是整屏压暗再抠一块——canvas 没有
    // 「擦回原样」这回事。
    ctx.fillStyle = DIM;
    ctx.fillRect(0, 0, box.w, Math.max(0, sy0));
    ctx.fillRect(0, sy1, box.w, Math.max(0, box.h - sy1));
    ctx.fillRect(0, sy0, Math.max(0, sx0), Math.max(0, sy1 - sy0));
    ctx.fillRect(sx1, sy0, Math.max(0, box.w - sx1), Math.max(0, sy1 - sy0));

    // 豆阵参考线：让用户对「这么多格够不够细」有个概念
    if (rows > 0 && cols > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      const step = Math.max(1, Math.round(Math.max(rows, cols) / GUIDE_LINES));
      for (let j = step; j < cols; j += step) {
        const x = sx0 + ((sx1 - sx0) * j) / cols;
        ctx.beginPath();
        ctx.moveTo(x, sy0);
        ctx.lineTo(x, sy1);
        ctx.stroke();
      }
      for (let i = step; i < rows; i += step) {
        const y = sy0 + ((sy1 - sy0) * i) / rows;
        ctx.beginPath();
        ctx.moveTo(sx0, y);
        ctx.lineTo(sx1, y);
        ctx.stroke();
      }
    }

    // 白衬 + 绿线画两遍：照片本身花花绿绿，单一条绿线压上去找不着
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

  // 放大镜。和 GridConfirm 同一套：拖角点时手指正压在要对准的那一点上。
  useEffect(() => {
    const cv = loupeRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(LOUPE * dpr));
    cv.height = Math.max(1, Math.round(LOUPE * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, LOUPE, LOUPE);
    if (!loupe || !img) return;

    const span = loupeSpan(
      (rect[2] - rect[0]) / Math.max(1, cols),
      (rect[3] - rect[1]) / Math.max(1, rows),
    );
    const [ix, iy] = loupe;
    ctx.fillStyle = '#f2f3f5';
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, ix - span / 2, iy - span / 2, span, span, 0, 0, LOUPE, LOUPE);
    const mid = LOUPE / 2;
    for (const [color, w] of [
      ['rgba(255,255,255,0.9)', 4],
      ['#2ea043', 2],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(mid, 0);
      ctx.lineTo(mid, LOUPE);
      ctx.moveTo(0, mid);
      ctx.lineTo(LOUPE, mid);
      ctx.stroke();
    }
  }, [loupe, img, rect, rows, cols]);

  function local(e: { clientX: number; clientY: number }): [number, number] {
    const b = (boxRef.current ?? canvasRef.current)?.getBoundingClientRect();
    return [e.clientX - (b?.left ?? 0), e.clientY - (b?.top ?? 0)];
  }

  // --- 指针：拖角改大小、框里拖动挪框、框外拖动平移视图、两指捏合缩放 ---
  const pointers = useRef(new Map<number, [number, number]>());
  const drag = useRef<Corner | null>(null);
  /** 在框里按下的那一点（图像坐标），用来算整框位移。 */
  const grab = useRef<[number, number] | null>(null);
  const pan = useRef<[number, number] | null>(null);
  const pinch = useRef<number | null>(null);
  const pinchMid = useRef<[number, number] | null>(null);

  function startPinch() {
    drag.current = null;
    grab.current = null;
    pan.current = null;
    setLoupe(null);
    const [a, b] = [...pointers.current.values()];
    pinch.current = Math.hypot(a![0] - b![0], a![1] - b![1]);
    pinchMid.current = [(a![0] + b![0]) / 2, (a![1] + b![1]) / 2];
  }

  function onDown(e: React.PointerEvent, corner: Corner | null = null) {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) return startPinch();

    if (corner !== null) {
      drag.current = corner;
      setLoupe(corners(rect)[corner]!);
      return;
    }
    const [sx0, sy0] = toScreen(rect[0], rect[1], view);
    const [sx1, sy1] = toScreen(rect[2], rect[3], view);
    const radius = e.pointerType === 'touch' ? HIT_TOUCH : HIT_MOUSE;
    const c = hitCorner([sx0, sy0, sx1, sy1], p[0], p[1], radius);
    if (c !== null) {
      drag.current = c;
      setLoupe(corners(rect)[c]!);
      return;
    }
    // 框**里面**按下 = 挪框；框外面 = 平移视图。用户会两样都想做。
    const [ix, iy] = toImage(p[0], p[1], view);
    if (ix >= rect[0] && ix <= rect[2] && iy >= rect[1] && iy <= rect[3]) {
      grab.current = [ix, iy];
    } else {
      pan.current = p;
    }
  }

  function onMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size >= 2 && pinch.current !== null) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a![0] - b![0], a![1] - b![1]);
      const mx = (a![0] + b![0]) / 2;
      const my = (a![1] + b![1]) / 2;
      const from = pinch.current;
      const was = pinchMid.current;
      setView((v) => {
        let next = v;
        if (d > 0 && from > 0) {
          next = zoomAt(next, mx, my, d / from, base * ZOOM_MIN, base * ZOOM_MAX);
        }
        if (was) next = { ...next, ox: next.ox + mx - was[0], oy: next.oy + my - was[1] };
        return next;
      });
      pinch.current = d;
      pinchMid.current = [mx, my];
      return;
    }

    const [ix, iy] = toImage(p[0], p[1], view);
    if (drag.current !== null) {
      const corner = drag.current;
      setRect((r) => resizeCorner(r, corner, ix, iy, aspect, guess.width, guess.height));
      setLoupe([ix, iy]);
      return;
    }
    if (grab.current) {
      const [gx, gy] = grab.current;
      setRect((r) => moveBox(r, ix - gx, iy - gy, guess.width, guess.height));
      // 抓点跟着框走：框被边界夹住之后，手指再往外挪不该继续累积位移
      const [nx, ny] = [ix, iy];
      grab.current = [nx, ny];
      return;
    }
    if (pan.current) {
      setView((v) => ({ ...v, ox: v.ox + p[0] - prev[0], oy: v.oy + p[1] - prev[1] }));
    }
  }

  function onUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    drag.current = null;
    grab.current = null;
    pan.current = null;
    setLoupe(null);
    if (pointers.current.size < 2) {
      pinch.current = null;
      pinchMid.current = null;
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = canvas.getBoundingClientRect();
      setView((v) =>
        zoomAt(v, e.clientX - b.left, e.clientY - b.top,
               Math.exp(-e.deltaY / 400), base * ZOOM_MIN, base * ZOOM_MAX),
      );
    };
    const onMultiTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onMultiTouch, { passive: false });
    canvas.addEventListener('touchmove', onMultiTouch, { passive: false });
    canvas.addEventListener('gesturestart', onGesture);
    canvas.addEventListener('gesturechange', onGesture);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onMultiTouch);
      canvas.removeEventListener('touchmove', onMultiTouch);
      canvas.removeEventListener('gesturestart', onGesture);
      canvas.removeEventListener('gesturechange', onGesture);
    };
  });

  const loupePos = (() => {
    if (!loupe) return undefined;
    const [sx, sy] = toScreen(loupe[0], loupe[1], view);
    const [v, h] = loupeAnchor(sx, sy, box.w, box.h);
    return { [v]: 8, [h]: 8 } as React.CSSProperties;
  })();

  const ready = rows > 0 && cols > 0;
  const CORNER_NAME = ['左上', '右上', '右下', '左下'] as const;

  return (
    <div className="grid-confirm">
      {gone && <p className="error">原图已不存在，没法框选。请重新上传。</p>}
      {!img && !gone && <p className="muted">正在载入原图…</p>}

      <div className="grid-confirm-stage" ref={boxRef}>
        <canvas
          ref={canvasRef}
          aria-label="框选范围"
          style={{ touchAction: 'pan-y', width: '100%', height: '100%' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {corners(rect).map(([ix, iy], i) => {
          const [cx, cy] = toScreen(ix, iy, view);
          return (
            <span
              key={CORNER_NAME[i]}
              className="grid-corner"
              aria-label={`${CORNER_NAME[i]}角点`}
              style={{ left: cx, top: cy }}
              onPointerDown={(e) => onDown(e, i as Corner)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
          );
        })}
        {loupe && (
          <canvas
            ref={loupeRef}
            className="grid-loupe"
            aria-label="放大镜"
            style={{ width: LOUPE, height: LOUPE, ...loupePos }}
          />
        )}
      </div>

      <div className="grid-confirm-zoom">
        <button type="button" onClick={fit}>
          适应
        </button>
        <button
          type="button"
          onClick={() => setRect(fitBox(guess.width, guess.height, aspect))}
        >
          框住整图
        </button>
        <span className="muted">
          框里拖动挪位置，拖角点改大小（比例锁死成 {cols}:{rows}）；框外拖动平移，
          滚轮或双指捏合缩放
        </span>
      </div>

      <div className="grid-confirm-controls">
        <label>
          行数
          <input type="number" min={1} max={200} value={rows}
                 onChange={(e) => setRows(Number(e.target.value))} />
        </label>
        <label>
          列数
          <input type="number" min={1} max={200} value={cols}
                 onChange={(e) => setCols(Number(e.target.value))} />
        </label>
        <label>
          色卡
          <select value={palette} onChange={(e) => setPalette(e.target.value as CandidateSet)}>
            <option value="221">Mard-221</option>
            <option value="291">Mard-291</option>
          </select>
        </label>
        <label>
          生成方式
          <select value={style} onChange={(e) => setStyle(e.target.value as 'slic' | 'dpid')}>
            <option value="slic">轮廓优先（推荐，边缘干净）</option>
            <option value="dpid">快速（边缘会糊一点）</option>
          </select>
        </label>
        <label>
          {/* 一颗四邻都不同的豆子，视觉上是噪点，实物上还要为它单买一整包 */}
          <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} />
          去掉孤立的单颗豆子
        </label>
        <button
          type="button"
          className="primary"
          disabled={!ready || busy}
          onClick={() =>
            onConfirm({ rect: [...rect], rows, cols, palette, style, clean })
          }
        >
          生成图纸
        </button>
      </div>
    </div>
  );
}
