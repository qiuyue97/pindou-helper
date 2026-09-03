import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Sheet } from '../../api/types';
import { drawSheet, layout, sheetToDrawing } from '../../lib/sheetExport';
import { byCode } from '../../lib/sheetSort';
import { useEffectiveCatalog } from '../../state/useEffectiveCatalog';

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
 * 按钮，放大后**按住拖动平移**。这里是**重画**不是 CSS 变换——按更大的格子重跑
 * layout，canvas 的像素数跟着涨，所以怎么放都清晰。
 *
 * 尺寸策略（两条都是踩坑踩出来的）：
 *   - **取景框尺寸恒定** = 1 倍时的图纸宽高，任何缩放级别都不变。1 倍时 canvas
 *     刚好填满、overflow hidden；放大后 canvas 溢出、overflow auto，滚动/拖动
 *     平移。框不变 -> 下方元素不动 -> **滚轮缩放不跳**。之前跳就是因为放大后
 *     把框钉成 80vh，和 1 倍的高不一样，下面的东西被顶上来。
 *   - 只按宽度收，高度随它——图纸长一点无所谓。取景框在 .preview-wrap 里
 *     **居中**（margin auto），两边留等宽白边，不再左贴边右留白。
 *
 * 每次改动（改整类、改豆点、改图纸数量）都会重画：`sheet` 一变，useMemo 重算。
 */
export default function SheetPreview({ sheet }: { sheet: Sheet }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { byCode: catalogue } = useEffectiveCatalog();
  /** 选中的色号：只画这些，其余调淡。空 = 全部照常。 */
  const [focus, setFocus] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [availW, setAvailW] = useState(1400);
  /** 缩放后把滚动条挪到这里，让光标/双指中点那一点不动。 */
  const pendingAnchor = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);

  const drawing = useMemo(
    () => sheetToDrawing(sheet, (code) => catalogue.get(code)?.hex, byCode),
    [sheet, catalogue],
  );
  const legendLen = drawing.legend.length;

  // 可用宽度：预览框自己的宽（= .sheet-page 的宽）。
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth || 1400;
      setAvailW((p) => (Math.abs(p - w) < 1 ? p : w));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 1 倍：只按宽度收，高度随它。
  const base = useMemo(
    () => layout(sheet.rows, sheet.cols, legendLen, { maxWidth: availW }),
    [sheet.rows, sheet.cols, legendLen, availW],
  );
  const lay = useMemo(
    () =>
      zoom === 1
        ? base
        : layout(sheet.rows, sheet.cols, legendLen, {
            cell: base.cell * zoom,
            maxWidth: 8000,
          }),
    [base, zoom, sheet.rows, sheet.cols, legendLen],
  );

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

  // 取景框尺寸不随 zoom 变，所以不用再补偿页面滚动——只把取景框内部滚到锚点。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = pendingAnchor.current;
    if (el && a) {
      pendingAnchor.current = null;
      el.scrollLeft = a.cx - a.px;
      el.scrollTop = a.cy - a.py;
    }
  }, [zoom]);

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
  // 自己挂一个非被动的。
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

  // 一根指头/按住左键（放大后）拖着平移，两根指头捏合缩放。
  const pts = useRef(new Map<number, [number, number]>());
  const pinchDist = useRef<number | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinchDist.current = Math.hypot(a![0] - b![0], a![1] - b![1]);
    } else if (zoom > 1) {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const prev = pts.current.get(e.pointerId);
    if (!prev) return;
    pts.current.set(e.pointerId, [e.clientX, e.clientY]);
    const el = scrollRef.current;
    if (!el) return;

    if (pts.current.size >= 2 && pinchDist.current !== null) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a![0] - b![0], a![1] - b![1]);
      const from = pinchDist.current;
      if (d > 0 && from > 0) {
        const rect = el.getBoundingClientRect();
        zoomAround(d / from, (a![0] + b![0]) / 2 - rect.left, (a![1] + b![1]) / 2 - rect.top);
      }
      pinchDist.current = d;
      return;
    }

    if (zoom > 1) {
      el.scrollLeft -= e.clientX - prev[0];
      el.scrollTop -= e.clientY - prev[1];
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pts.current.delete(e.pointerId);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (pts.current.size < 2) pinchDist.current = null;
  }

  if (!sheet.rows || !sheet.cols) return null;
  return (
    <div ref={wrapRef} className="preview-wrap">
      <div className="preview-zoom">
        <span>{zoom === 1 ? '滚轮或双指缩放' : `${Math.round(zoom * 100)}%`}</span>
        {zoom !== 1 && (
          <button type="button" className="linklike" onClick={() => setZoom(1)}>
            复位
          </button>
        )}
      </div>

      {/* 取景框恒为 1 倍图纸的宽高，居中。1 倍时 canvas 刚好填满；放大后溢出，
          滚动/拖动平移。框尺寸不变 -> 下方元素不动 -> 缩放不跳。 */}
      <div
        ref={scrollRef}
        className="preview-scroll"
        style={{
          width: base.width,
          height: base.height,
          maxWidth: '100%',
          margin: '0 auto',
          overflow: zoom === 1 ? 'hidden' : 'auto',
          touchAction: zoom === 1 ? 'auto' : 'none',
          cursor: zoom === 1 ? 'default' : 'grab',
        }}
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
          style={{ display: 'block' }}
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
    </div>
  );
}
