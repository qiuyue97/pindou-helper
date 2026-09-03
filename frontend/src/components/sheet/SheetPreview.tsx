import { useEffect, useMemo, useRef } from 'react';
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
    });
  }, [sheet.rows, sheet.cols, drawing, lay]);

  if (!sheet.rows || !sheet.cols) return null;
  return (
    <canvas
      ref={ref}
      aria-label="完整图纸"
      width={lay.width}
      height={lay.height}
      style={{ maxWidth: '100%', height: 'auto', border: '1px solid rgba(0,0,0,0.15)' }}
    />
  );
}
