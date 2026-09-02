import { useEffect, useMemo, useRef } from 'react';
import type { Sheet } from '../../api/types';
import { useEffectiveCatalog } from '../../state/useEffectiveCatalog';

/** 整张图最长边压在这个像素数以内，手机上放得下。 */
const MAX_SIDE = 900;

/** 色卡里没有的色号（理论上不该出现）用它，免得整格不画看起来像空格。 */
const UNKNOWN = 'CCCCCC';

/**
 * 完整图纸：矩阵 → canvas 填色。
 *
 * 服务端不渲染任何图片。前端有 labels、classes、overrides 和色卡，自己画就行；
 * 104×104 = 10,816 个 fillRect 是毫秒级的事，而同样数量的 DOM 节点会让 iOS 卡死。
 *
 * 颜色取「我的色卡」的有效色值——用户看到的是自己那盒豆子拼出来会是什么样，
 * 而不是第三方生成器的印刷色。（识别时的颜色匹配用的是 BASE 原始色，那是另一
 * 回事：那里要还原生成器的意图，这里要预览用户的成品。）
 */
export default function SheetCanvas({
  sheet,
  highlight,
  onPickCell,
}: {
  sheet: Sheet;
  /** 要描边的格子（扁平下标），比如当前展开的那个色号 */
  highlight?: number[];
  onPickCell?: (r: number, c: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { byCode } = useEffectiveCatalog();
  const { rows, cols } = sheet;
  const cell = rows && cols ? Math.max(1, Math.floor(MAX_SIDE / Math.max(rows, cols))) : 1;
  const marked = useMemo(() => new Set(highlight ?? []), [highlight]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !rows || !cols) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const codeOf = new Map(sheet.classes.map((c) => [c.klass, c.code]));
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const over = sheet.overrides[`${r},${c}`];
        const k = sheet.labels[i];
        const code = over ?? (k !== undefined && k >= 0 ? codeOf.get(k) : undefined);
        if (!code) continue; // 空格不画，露出底色
        ctx.fillStyle = `#${byCode.get(code)?.hex ?? UNKNOWN}`;
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }

    if (marked.size) {
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      for (const i of marked) {
        ctx.strokeRect(
          (i % cols) * cell + 0.5,
          Math.floor(i / cols) * cell + 0.5,
          cell - 1,
          cell - 1,
        );
      }
    }
  }, [sheet, marked, byCode, rows, cols, cell]);

  return (
    <canvas
      ref={ref}
      aria-label="完整图纸"
      width={cols * cell}
      height={rows * cell}
      style={{ maxWidth: '100%', touchAction: 'none' }}
      onClick={(e) => {
        if (!onPickCell || !rows || !cols) return;
        const box = e.currentTarget.getBoundingClientRect();
        if (!box.width) return;
        const k = e.currentTarget.width / box.width;
        const c = Math.floor(((e.clientX - box.left) * k) / cell);
        const r = Math.floor(((e.clientY - box.top) * k) / cell);
        if (r >= 0 && r < rows && c >= 0 && c < cols) onPickCell(r, c);
      }}
    />
  );
}
