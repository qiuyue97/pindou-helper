import { useEffect, useMemo, useRef, useState } from 'react';
import type { Sheet } from '../../api/types';
import { drawSheet, layout, sheetToDrawing } from '../../lib/sheetExport';
import { byCode } from '../../lib/sheetSort';
import { useEffectiveCatalog } from '../../state/useEffectiveCatalog';

/**
 * 屏幕上显示的图纸宽度上限。
 *
 * 下载用 8000（104 列还能有 32px 的格子，色号印得清清楚楚）；屏幕上没必要那么大——
 * 一张 104x104 的图按 32px 是 3.4k 宽、上万次 fillText，每改一个豆点都重画一遍
 * 会明显卡顿。这里只是缩小，**格式和下载完全一样**：同一个 drawSheet、同一份
 * 绘制参数，只有格子尺寸不同。
 */
const PREVIEW_MAX_WIDTH = 1400;

/**
 * 图纸预览：和「下载图纸」用**同一个渲染器**画出来的同一张图。
 *
 * 两处分开画过一次，结果就是屏幕上一套、下载下来另一套——用户照着屏幕拼，拿到的
 * 文件却是别的东西。现在共用 sheetToDrawing + drawSheet，想不一致都难。
 *
 * 每次改动（改整类、改豆点、改图纸数量）都会重画：`sheet` 一变，useMemo 重算，
 * effect 重跑。
 */
export default function SheetPreview({ sheet }: { sheet: Sheet }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { byCode: catalogue } = useEffectiveCatalog();
  /** 选中的色号：只画这些，其余调淡。空 = 全部照常。 */
  const [focus, setFocus] = useState<Set<string>>(new Set());

  const drawing = useMemo(
    () => sheetToDrawing(sheet, (code) => catalogue.get(code)?.hex, byCode),
    [sheet, catalogue],
  );
  const lay = useMemo(
    () => layout(sheet.rows, sheet.cols, drawing.legend.length, {
      maxWidth: PREVIEW_MAX_WIDTH,
    }),
    [sheet.rows, sheet.cols, drawing.legend.length],
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

  if (!sheet.rows || !sheet.cols) return null;
  return (
    <>
      <canvas
        ref={ref}
        aria-label="完整图纸"
        width={lay.width}
        height={lay.height}
        style={{ maxWidth: '100%', height: 'auto', border: '1px solid rgba(0,0,0,0.15)' }}
      />
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
