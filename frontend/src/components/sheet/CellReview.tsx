import { useEffect, useMemo, useRef, useState } from 'react';
import type { Sheet } from '../../api/types';
import { type Rect, cellRect } from '../../lib/sheetGeometry';
import { LEVEL_WHY, type CodeGroup, groupByCode } from '../../lib/sheetSort';
import CodePicker from './CodePicker';

/** 每格在校对网格里画多大（设备像素）。够看清印在上面的色号。 */
const TILE = 44;
const PER_ROW = 12;

/**
 * 一页最多画这么多格。
 *
 * 单个色号可能有近三千格（D63E4322 的 H2 是 2961 格）。画布画多少都不怕，但
 * **可点击层是真的 DOM 节点**——三千个 checkbox 在 iOS 上和一万格进 DOM 是同一个
 * 问题。所以画布按页画，可点击层跟着页走，节点数有上界。
 */
const PER_PAGE = PER_ROW * 10;

export interface CellPatch {
  r: number;
  c: number;
  code: string;
}

/**
 * 按色号分组的格子校对。
 *
 * 这里**只做单格和多选**。改整类不在格子的操作空间里——要动整类，去上面的对账表。
 *
 * 默认每个色号一张卡（色块 + 数量 + 状态），告警优先；展开某组才画它的格子。
 * 格子的像素直接从原图裁——客户端本来就有原图和 (rect, rows, cols)，服务端不需要
 * 产出任何切片。
 */
export default function CellReview({
  sheet,
  onPatchCells,
}: {
  sheet: Sheet;
  onPatchCells: (patches: CellPatch[]) => void;
}) {
  const groups = useMemo(() => groupByCode(sheet.classes), [sheet.classes]);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="cell-review">
      {groups.map((g) => (
        <section key={g.code} className={`cell-card level-${g.level}`}>
          <button
            type="button"
            aria-label={`展开 ${g.code}`}
            aria-expanded={open === g.code}
            onClick={() => setOpen(open === g.code ? null : g.code)}
          >
            {g.classes.map((c) => (
              <span
                key={c.klass}
                className="swatch"
                style={{ background: `rgb(${c.rgb.join(',')})` }}
              />
            ))}
            <strong>{g.code}</strong>
            <span className="muted">{g.n} 格</span>
            {LEVEL_WHY[g.level] && <span className="why">{LEVEL_WHY[g.level]}</span>}
          </button>
          {open === g.code && (
            <CellGrid sheet={sheet} group={g} onPatchCells={onPatchCells} />
          )}
        </section>
      ))}
    </div>
  );
}

function CellGrid({
  sheet,
  group,
  onPatchCells,
}: {
  sheet: Sheet;
  group: CodeGroup;
  onPatchCells: (patches: CellPatch[]) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { cols } = sheet;

  const pageCells = group.cells.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const pageCount = Math.max(1, Math.ceil(group.cells.length / PER_PAGE));
  const rows = Math.max(1, Math.ceil(pageCells.length / PER_ROW));

  // 原图只加载一次，之后每格都是从它上面 drawImage 裁出来的一小块
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const im = new Image();
    im.src = `/api/sheets/${sheet.id}/image`;
    im.onload = () => {
      pageCells.forEach((flat, n) => {
        const { sx, sy, sw, sh } = cellRect(
          sheet.rect as Rect,
          sheet.rows,
          sheet.cols,
          Math.floor(flat / cols),
          flat % cols,
        );
        ctx.drawImage(
          im,
          sx,
          sy,
          sw,
          sh,
          (n % PER_ROW) * TILE,
          Math.floor(n / PER_ROW) * TILE,
          TILE,
          TILE,
        );
      });
    };
  }, [sheet.id, sheet.rect, sheet.rows, sheet.cols, cols, pageCells]);

  const list = [...picked].sort((a, b) => a - b);

  return (
    <div className="cell-grid-wrap">
      {/* canvas 和勾选层必须在**同一个贴合 canvas 尺寸**的容器里。
          先前勾选层是 absolute + left/right:0，撑满的是外层（还装着分页和操作条）
          的宽度，于是 12 列被摊到上千像素上，格子和勾选框整个对不上。 */}
      <div className="cell-grid-stack">
        <canvas
          ref={ref}
          className="cell-grid"
          width={PER_ROW * TILE}
          height={rows * TILE}
          style={{ maxWidth: '100%', touchAction: 'manipulation' }}
        />
        {/* canvas 画像素，这一层负责可访问性和点击。节点数被 PER_PAGE 封住，
            不会随色号的格子数长。 */}
        <div
          className="cell-hits"
          style={{
            gridTemplateColumns: `repeat(${PER_ROW}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {pageCells.map((flat) => {
            const r = Math.floor(flat / cols);
            const c = flat % cols;
            const over = sheet.overrides[`${r},${c}`];
            const on = picked.has(flat);
            return (
              <span
                key={flat}
                className={`cell-hit${over ? ' edited' : ''}${on ? ' picked' : ''}`}
              >
                <input
                  type="checkbox"
                  aria-label={`第 ${r + 1} 行第 ${c + 1} 列`}
                  checked={on}
                  onChange={() =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (next.has(flat)) next.delete(flat);
                      else next.add(flat);
                      return next;
                    })
                  }
                />
                {over && (
                  <button
                    type="button"
                    className="ghost undo"
                    aria-label={`撤销第 ${r + 1} 行第 ${c + 1} 列`}
                    onClick={() => onPatchCells([{ r, c, code: '' }])}
                  >
                    ↺
                  </button>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {pageCount > 1 && (
        <div className="cell-pager">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span>
            第 {page + 1} / {pageCount} 页，共 {group.cells.length} 格
          </span>
          <button
            type="button"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <p className="muted">选中格子后可以改它们的色号。改整类请用上面的对账表。</p>
      ) : (
        <div className="cell-actions">
          <span>已选 {list.length} 格 →</span>
          <CodePicker
            value=""
            scope={sheet.palette}
            label="把选中的格子改成"
            onChange={(code) => {
              onPatchCells(
                list.map((flat) => ({ r: Math.floor(flat / cols), c: flat % cols, code })),
              );
              setPicked(new Set());
            }}
          />
        </div>
      )}
    </div>
  );
}
