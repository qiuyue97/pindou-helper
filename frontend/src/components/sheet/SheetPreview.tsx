import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Sheet } from '../../api/types';
import { RING_PX, drawRingOverlay, drawSheet, layout, sheetToDrawing } from '../../lib/sheetExport';
import { byCode } from '../../lib/sheetSort';
import { useEffectiveCatalog } from '../../state/useEffectiveCatalog';

/**
 * 放大的上限由**画布像素**定，不是拍脑袋的常数。
 *
 * 放大是重画：格子涨一倍，画布面积涨四倍。104×104 的图纸放到 64 像素一格就是
 * 四千多万像素、一百多兆显存，手机上直接开不出来。反过来，手机上 1 倍的格子只有
 * 三四个像素，卡死在固定的 6 倍又根本不够看。所以上限按图纸大小算出来。
 */
const MAX_CANVAS_PX = 24e6;
const MAX_CELL = 64;

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
 * 三条尺寸策略，都是踩坑踩出来的：
 *   - **取景框尺寸恒定** = 1 倍时的图纸宽高，任何缩放级别都不变。1 倍时 canvas
 *     刚好填满、overflow hidden；放大后 canvas 溢出、overflow auto，滚动/拖动
 *     平移。框不变 -> 下方元素不动 -> **滚轮缩放不跳**。
 *   - 只按宽度收，高度随它——图纸长一点无所谓。外框在 .preview-wrap 里**居中**，
 *     两边留等宽白边。
 *   - 1 倍必须**一屏看全**，所以 minCell 放到 2：手机上一百来列摊在 320 像素里
 *     只能是三四个像素一格，卡在导出用的 8 上就会被取景框裁掉右边一大截。
 *
 * 坐标外圈不画在图里，而是 drawRingOverlay 贴在取景框四边（.preview-ring）：
 * 画在图里的那圈一放大就滚出视野，偏偏放大就是在数第几行第几列的时候。
 */
export default function SheetPreview({ sheet }: { sheet: Sheet }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ringRef = useRef<HTMLCanvasElement>(null);
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

  // 1 倍：只按宽度收，高度随它。四周还要让出一圈坐标带的位置。
  const base = useMemo(
    () =>
      previewLayout(sheet.rows, sheet.cols, legendLen, {
        maxWidth: Math.max(120, availW - RING_PX * 2),
      }),
    [sheet.rows, sheet.cols, legendLen, availW],
  );
  const lay = useMemo(
    () =>
      zoom === 1
        ? base
        : previewLayout(sheet.rows, sheet.cols, legendLen, {
            cell: base.cell * zoom,
            maxWidth: 1e6,
          }),
    [base, zoom, sheet.rows, sheet.cols, legendLen],
  );
  const zoomMax = useMemo(() => {
    const cap = Math.min(
      MAX_CELL,
      Math.sqrt(MAX_CANVAS_PX / Math.max(1, sheet.rows * sheet.cols)),
    );
    return Math.max(2, Math.min(16, cap / Math.max(1, base.cell)));
  }, [sheet.rows, sheet.cols, base.cell]);

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

  /** 贴边坐标圈。它跟着**视野**走，所以滚一下、缩一下都得重画。 */
  const paintRing = useCallback(() => {
    const ctx = ringRef.current?.getContext('2d');
    const box = scrollRef.current;
    if (!ctx || !box || !sheet.rows || !sheet.cols) return;
    drawRingOverlay(ctx, {
      rows: sheet.rows,
      cols: sheet.cols,
      cell: lay.cell,
      scrollX: box.scrollLeft,
      scrollY: box.scrollTop,
      viewW: base.width,
      viewH: base.height,
      ring: RING_PX,
    });
  }, [sheet.rows, sheet.cols, lay.cell, base.width, base.height]);

  // 取景框尺寸不随 zoom 变，所以不用再补偿页面滚动——只把取景框内部滚到锚点。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = pendingAnchor.current;
    if (el && a) {
      pendingAnchor.current = null;
      el.scrollLeft = a.cx - a.px;
      el.scrollTop = a.cy - a.py;
    }
    paintRing();
  }, [paintRing]);

  function zoomAround(factor: number, px: number, py: number) {
    const el = scrollRef.current;
    if (!el) return;
    setZoom((z) => {
      const nz = Math.min(zoomMax, Math.max(1, z * factor));
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
  //
  // 触摸端还要多挡两道：`touch-action: pan-y` 只在标准实现里拦得住双指缩放，
  // iOS Safari 照样会去缩**整个页面**（用户原话「优先放大整个页面」）。所以多指的
  // touchstart/touchmove 直接 preventDefault，再把 Safari 私有的 gesture 事件挡掉。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAround(Math.exp(-e.deltaY / 400), e.clientX - rect.left, e.clientY - rect.top);
    };
    const onMultiTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onMultiTouch, { passive: false });
    el.addEventListener('touchmove', onMultiTouch, { passive: false });
    el.addEventListener('gesturestart', onGesture);
    el.addEventListener('gesturechange', onGesture);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onMultiTouch);
      el.removeEventListener('touchmove', onMultiTouch);
      el.removeEventListener('gesturestart', onGesture);
      el.removeEventListener('gesturechange', onGesture);
    };
  });

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

      {/* 外框恒为 1 倍图纸的宽高 + 四周一圈坐标带，居中。取景框嵌在这一圈里面：
          1 倍时 canvas 刚好填满；放大后溢出，滚动/拖动平移。外框尺寸不变 ->
          下方元素不动 -> 缩放不跳。 */}
      <div
        className="preview-frame"
        style={{ width: base.width + RING_PX * 2, height: base.height + RING_PX * 2 }}
      >
        <div
          ref={scrollRef}
          className="preview-scroll"
          style={{
            inset: RING_PX,
            overflow: zoom === 1 ? 'hidden' : 'auto',
            touchAction: zoom === 1 ? 'pan-y' : 'none',
            cursor: zoom === 1 ? 'default' : 'grab',
          }}
          onScroll={paintRing}
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
        {/* 坐标外圈：贴着取景框，既不跟着图缩放，也不跟着图滚走 */}
        <canvas
          ref={ringRef}
          className="preview-ring"
          aria-label="行列坐标"
          width={base.width + RING_PX * 2}
          height={base.height + RING_PX * 2}
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

/**
 * 预览用的版式。和导出差两处：
 *
 *   ring: false   外圈是贴边浮层，不画进图里
 *   minCell: 2    1 倍必须一屏看全，不能像导出那样卡在 8
 *
 * 再把底部汇总往下推一条外圈的厚度：贴边浮层的下沿落在网格正下方，没这条空当
 * 就会压住汇总的第一行色块。
 */
function previewLayout(
  rows: number,
  cols: number,
  legendLen: number,
  opts: { cell?: number; maxWidth: number },
) {
  const l = layout(rows, cols, legendLen, { ...opts, ring: false, minCell: 2 });
  return { ...l, legendTop: l.legendTop + RING_PX, height: l.height + RING_PX };
}
