import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Sheet } from '../../api/types';
import { drawSheet, layout, sheetToDrawing } from '../../lib/sheetExport';
import { byCode } from '../../lib/sheetSort';
import { useEffectiveCatalog } from '../../state/useEffectiveCatalog';

/**
 * 1 倍时屏幕上显示的图纸宽度。
 *
 * 下载用 8000（104 列还能有 32px 的格子，色号印得清清楚楚）；屏幕上 1 倍没必要
 * 那么大——一张 104x104 的图按 32px 是 3.4k 宽、上万次 fillText，每改一个豆点都
 * 重画一遍会明显卡顿。**格式和下载完全一样**：同一个 drawSheet、同一份绘制参数，
 * 只有格子尺寸不同。
 */
const PREVIEW_BASE_WIDTH = 1400;
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

const clamp = (n: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));

/**
 * 图纸预览：和「下载图纸」用**同一个渲染器**画出来的同一张图。
 *
 * 两处分开画过一次，结果就是屏幕上一套、下载下来另一套——用户照着屏幕拼，拿到的
 * 文件却是别的东西。现在共用 sheetToDrawing + drawSheet，想不一致都难。
 *
 * 缩放和 GridConfirm 一个路子：**滚轮**（桌面）/**双指捏合**（触摸），没有 +/-
 * 按钮。但这里是**重画**不是 CSS 变换——放大时按更大的格子重新跑 layout，canvas
 * 的像素数跟着涨，所以怎么放都清晰；平移交给外层滚动容器。CSS 拉伸一张位图只会
 * 越拉越糊。
 *
 * 每次改动（改整类、改豆点、改图纸数量）都会重画：`sheet` 一变，useMemo 重算，
 * effect 重跑。
 */
export default function SheetPreview({ sheet }: { sheet: Sheet }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { byCode: catalogue } = useEffectiveCatalog();
  /** 选中的色号：只画这些，其余调淡。空 = 全部照常。 */
  const [focus, setFocus] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  /** 缩放后要把滚动条挪到哪，让手指/光标下那一点不动。 */
  const pendingAnchor = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);

  const drawing = useMemo(
    () => sheetToDrawing(sheet, (code) => catalogue.get(code)?.hex, byCode),
    [sheet, catalogue],
  );
  const lay = useMemo(() => {
    // 1 倍 = 收进 PREVIEW_BASE_WIDTH（大图纸会自动缩小格子）。放大就是把这个
    // 格子尺寸乘上去，maxWidth 放开到下载的 8000 上限，让它真的按更大的像素重画。
    const base = layout(sheet.rows, sheet.cols, drawing.legend.length, {
      maxWidth: PREVIEW_BASE_WIDTH,
    });
    if (zoom === 1) return base;
    return layout(sheet.rows, sheet.cols, drawing.legend.length, {
      cell: base.cell * zoom,
      maxWidth: 8000,
    });
  }, [sheet.rows, sheet.cols, drawing.legend.length, zoom]);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx || !sheet.rows || !sheet.cols) return;
    drawSheet(ctx, {
      rows: sheet.rows,
      cols: sheet.cols,
      cells: drawing.cells,
      legend: drawing.legend,
      layout: lay,
      focus,
    });
  }, [sheet.rows, sheet.cols, drawing, lay, focus]);

  // 缩放后把滚动位置挪回去，让锚点（光标 / 双指中点）停在原地
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = pendingAnchor.current;
    if (!el || !a) return;
    pendingAnchor.current = null;
    el.scrollLeft = a.cx - a.px;
    el.scrollTop = a.cy - a.py;
  }, [zoom]);

  /** 以容器内 (px, py) 为锚点缩放。内容尺寸随 zoom 近似线性，所以内容坐标乘同一个比例。 */
  function zoomAround(factor: number, px: number, py: number) {
    const el = scrollRef.current;
    if (!el) return;
    setZoom((z) => {
      const nz = clamp(z * factor);
      if (nz === z) return z;
      const ratio = nz / z;
      pendingAnchor.current = {
        cx: (el.scrollLeft + px) * ratio,
        cy: (el.scrollTop + py) * ratio,
        px,
        py,
      };
      return nz;
    });
  }

  // 滚轮缩放。React 的 onWheel 是被动监听，preventDefault 无效（页面会跟着滚），
  // 自己挂一个非被动的。和 GridConfirm 同一套。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAround(Math.exp(-e.deltaY / 400), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 双指捏合
  const pts = useRef(new Map<number, [number, number]>());
  const pinchDist = useRef<number | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinchDist.current = Math.hypot(a![0] - b![0], a![1] - b![1]);
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.current.size < 2 || pinchDist.current === null) return;
    const [a, b] = [...pts.current.values()];
    const d = Math.hypot(a![0] - b![0], a![1] - b![1]);
    const from = pinchDist.current;
    if (d > 0 && from > 0) {
      const el = scrollRef.current!;
      const rect = el.getBoundingClientRect();
      zoomAround(d / from, (a![0] + b![0]) / 2 - rect.left, (a![1] + b![1]) / 2 - rect.top);
    }
    pinchDist.current = d;
  }
  function onPointerUp(e: React.PointerEvent) {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinchDist.current = null;
  }

  if (!sheet.rows || !sheet.cols) return null;
  return (
    <>
      <div className="preview-zoom">
        <span>{zoom === 1 ? '滚轮或双指缩放' : `${Math.round(zoom * 100)}%`}</span>
        {zoom !== 1 && (
          <button type="button" className="linklike" onClick={() => setZoom(1)}>
            复位
          </button>
        )}
      </div>

      {/* 1 倍时**完整显示**，不出滚动条——整张图收进容器宽度就够看了。放大之后
          画布比容器大，这时才变成可滚动的取景框，滚动来平移。
          touch-action: none 让双指手势不被浏览器抢去做页面缩放。 */}
      <div
        ref={scrollRef}
        className="preview-scroll"
        style={
          zoom === 1
            ? { overflow: 'visible', maxHeight: 'none', touchAction: 'pan-x pan-y' }
            : { overflow: 'auto', maxHeight: '80vh', touchAction: 'none' }
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas
          ref={ref}
          aria-label="完整图纸"
          width={lay.width}
          height={lay.height}
          style={{
            display: 'block',
            maxWidth: zoom === 1 ? '100%' : 'none',
            height: 'auto',
            border: '1px solid rgba(0,0,0,0.15)',
          }}
        />
      </div>

      {/* 选几个色号突出显示。拼的时候是一个色号一个色号摆的，把它从满图里挑出来
          看，比对着一张花图找要省眼睛得多。 */}
      <div className="focus-bar" aria-label="突出显示色号">
        {drawing.legend.map((e) => {
          const on = focus.has(e.code);
          return (
            <button
              key={e.code}
              type="button"
              className={`chip${on ? ' on' : ''}`}
              aria-pressed={on}
              onClick={() =>
                setFocus((f) => {
                  const next = new Set(f);
                  if (!next.delete(e.code)) next.add(e.code);
                  return next;
                })
              }
            >
              <span className="swatch" style={{ background: `#${e.hex}` }} />
              {e.code}
            </button>
          );
        })}
        {focus.size > 0 && (
          <button type="button" className="linklike" onClick={() => setFocus(new Set())}>
            全部显示
          </button>
        )}
      </div>
    </>
  );
}
