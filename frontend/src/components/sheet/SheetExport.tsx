import { useState } from 'react';
import type { Sheet } from '../../api/types';
import { drawSheet, layout, sheetToDrawing } from '../../lib/sheetExport';
import { byCode } from '../../lib/sheetSort';
import { useToast } from '../../state/ToastContext';
import { useEffectiveCatalog } from '../../state/useEffectiveCatalog';

/**
 * 把校对好的图纸导出成一张 PNG：坐标标尺 + 网格线 + 格内色号 + 底部汇总。
 *
 * 用的是**校对之后**的归属（labels + classes + overrides），不是识别的原始输出——
 * 用户改过的那些格子必须体现在导出的图上，否则他照着拼出来的还是错的。
 */
export default function SheetExport({ sheet }: { sheet: Sheet }) {
  const { byCode: catalogue } = useEffectiveCatalog();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      // 和屏幕上那张预览**共用同一份转换和同一个渲染器**——想不一致都难
      const { cells, legend } = sheetToDrawing(
        sheet,
        (code) => catalogue.get(code)?.hex,
        byCode,
      );

      const lay = layout(sheet.rows, sheet.cols, legend.length);
      const canvas = document.createElement('canvas');
      canvas.width = lay.width;
      canvas.height = lay.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('这个浏览器画不了 canvas');
      drawSheet(ctx, { rows: sheet.rows, cols: sheet.cols, cells, legend, layout: lay });

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('导出失败');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `图纸-${sheet.id}-${sheet.rows}x${sheet.cols}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      show(e instanceof Error ? e.message : '导出失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" disabled={busy || !sheet.rows} onClick={() => void download()}>
      {busy ? '导出中…' : '下载图纸'}
    </button>
  );
}
