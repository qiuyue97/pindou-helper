import { useEffect, useMemo, useRef, useState } from 'react';
import type { CountRow, Sheet } from '../../api/types';
import { type Rect, cellRect } from '../../lib/sheetGeometry';
import { groupByCode } from '../../lib/sheetSort';
import CodePicker from './CodePicker';

/** 每格在校对网格里画多大（设备像素）。够看清印在上面的色号。 */
const TILE = 44;
const PER_ROW = 10;
/** 一页 50 个豆点。 */
const PER_PAGE = 50;

export interface CellPatch {
  r: number;
  c: number;
  code: string;
}

export interface SheetReviewProps {
  sheet: Sheet;
  /** 改整类：把这些类的色号都换掉，名下全部格子跟着变 */
  onPatchClasses: (patches: Array<{ k: number; code: string }>) => void;
  /** 改图纸数量：只动先验，不动格子 */
  onPatchPrior: (prior: Record<string, number>) => void;
  /** 改单个/多个豆点 */
  onPatchCells: (patches: CellPatch[]) => void;
}

/**
 * 图纸校对：左边一条色号栏，右边这个色号下的豆点。
 *
 * 左右两侧改的是**不同的东西**，但放在同一个界面里，因为用户看的是同一件事：
 *
 *   左边改色号 -> 这个色号名下**所有**豆点跟着改
 *   左边改数量 -> 只改「图纸说有多少」，不动任何豆点
 *   右边改豆点 -> 那几个豆点移出当前色号，进入目标色号；目标色号图例里没有的话
 *                 自动新开一条，标绿（那是用户确认过的，不是错误）
 */
export default function SheetReview({
  sheet,
  onPatchClasses,
  onPatchPrior,
  onPatchCells,
}: SheetReviewProps) {
  const rows = sheet.counts;
  const [active, setActive] = useState<string | null>(rows[0]?.code ?? null);
  const current = rows.find((r) => r.code === active) ?? rows[0] ?? null;

  return (
    <div className="sheet-review">
      <CodeColumn
        rows={rows}
        active={current?.code ?? null}
        hasPrior={Object.keys(sheet.prior).length > 0}
        palette={sheet.palette}
        onSelect={setActive}
        onRename={(row, code) => onPatchClasses(row.classes.map((k) => ({ k, code })))}
        onCount={(row, n) => {
          const next = { ...sheet.prior };
          if (n && n > 0) next[row.code] = n;
          else delete next[row.code];
          onPatchPrior(next);
        }}
      />
      {current ? (
        <CellPane key={current.code} sheet={sheet} row={current} onPatchCells={onPatchCells} />
      ) : (
        <p className="muted">这张图纸没有识别出任何色号。</p>
      )}
    </div>
  );
}

/** 左边那条细栏。 */
function CodeColumn({
  rows,
  active,
  hasPrior,
  palette,
  onSelect,
  onRename,
  onCount,
}: {
  rows: CountRow[];
  active: string | null;
  hasPrior: boolean;
  palette: Sheet['palette'];
  onSelect: (code: string) => void;
  onRename: (row: CountRow, code: string) => void;
  onCount: (row: CountRow, n: number | null) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <ul className="code-column" aria-label="色号列表">
      {rows.map((row) => {
        const mismatch = row.level === 'count';
        return (
          <li
            key={row.code}
            className={`code-row${row.code === active ? ' active' : ''}${
              mismatch ? ' mismatch' : ''
            }${row.custom ? ' custom' : ''}`}
          >
            <button
              type="button"
              className="code-row-pick"
              aria-label={`查看 ${row.code}`}
              aria-current={row.code === active}
              onClick={() => onSelect(row.code)}
            >
              {mismatch && (
                <span
                  className="flag mismatch"
                  title={`图纸说有 ${row.prior ?? 0} 个，已识别 ${row.sheet} 个`}
                >
                  !
                </span>
              )}
              {row.custom && (
                <span className="flag custom" title="图例里没有这个色号，是你自己加的">
                  ✓
                </span>
              )}
              <strong>{row.code}</strong>
            </button>

            <div className="code-row-edit">
              {editing === row.code ? (
                <CodePicker
                  value={row.code}
                  scope={palette}
                  autoFocus
                  label={`${row.code} 的新色号`}
                  onChange={(code) => {
                    setEditing(null);
                    onRename(row, code);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="linklike"
                  aria-label={`改色号 ${row.code}`}
                  disabled={row.classes.length === 0}
                  onClick={() => setEditing(row.code)}
                >
                  改色号
                </button>
              )}
            </div>

            <dl className="code-row-counts">
              {hasPrior && (
                <>
                  <dt>图纸数量</dt>
                  <dd>
                    <input
                      type="number"
                      min={0}
                      aria-label={`${row.code} 的图纸数量`}
                      defaultValue={row.prior ?? ''}
                      onBlur={(e) => onCount(row, Number(e.target.value) || null)}
                    />
                  </dd>
                </>
              )}
              <dt>已识别数量</dt>
              {/* 数出来的事实，不给改——要让它变只能去右边改豆点 */}
              <dd className="fact">{row.sheet}</dd>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

/** 右边：这个色号下的豆点，50 个一页。 */
function CellPane({
  sheet,
  row,
  onPatchCells,
}: {
  sheet: Sheet;
  row: CountRow;
  onPatchCells: (p: CellPatch[]) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const { cols } = sheet;

  // 这个色号名下的全部格子。含逐格覆盖进来的——它们没有类，但确实归这个色号。
  const cells = useMemo(() => {
    const byCode = new Map(groupByCode(sheet.classes).map((g) => [g.code, g]));
    const own = new Set(byCode.get(row.code)?.cells ?? []);
    for (const [key, code] of Object.entries(sheet.overrides)) {
      const [r, c] = key.split(',').map(Number);
      const flat = r! * cols + c!;
      if (code === row.code) own.add(flat);
      else own.delete(flat); // 被改去别的色号了，不再属于这里
    }
    return [...own].sort((a, b) => a - b);
  }, [sheet.classes, sheet.overrides, row.code, cols]);

  const pageCells = cells.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const pageCount = Math.max(1, Math.ceil(cells.length / PER_PAGE));
  const gridRows = Math.max(1, Math.ceil(pageCells.length / PER_ROW));

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
          im, sx, sy, sw, sh,
          (n % PER_ROW) * TILE, Math.floor(n / PER_ROW) * TILE, TILE, TILE,
        );
      });
    };
  }, [sheet.id, sheet.rect, sheet.rows, sheet.cols, cols, pageCells]);

  const list = [...picked].sort((a, b) => a - b);

  return (
    <div className="cell-pane">
      <p className="cell-pane-head">
        <strong>{row.code}</strong>
        <span className="muted">共 {cells.length} 个豆点</span>
      </p>

      {/* canvas 和勾选层必须在**同一个贴合 canvas 尺寸**的容器里，否则勾选框会被
          摊到整行宽度上、和格子完全对不上。 */}
      <div className="cell-grid-stack">
        <canvas
          ref={ref}
          className="cell-grid"
          width={PER_ROW * TILE}
          height={gridRows * TILE}
          style={{ maxWidth: '100%', touchAction: 'manipulation' }}
        />
        <div
          className="cell-hits"
          style={{
            gridTemplateColumns: `repeat(${PER_ROW}, 1fr)`,
            gridTemplateRows: `repeat(${gridRows}, 1fr)`,
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
            第 {page + 1} / {pageCount} 页
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
        <p className="muted">选中豆点后可以改它们的色号。改整个色号请用左边那一栏。</p>
      ) : (
        <div className="cell-actions">
          <span>已选 {list.length} 个 →</span>
          <CodePicker
            value=""
            scope={sheet.palette}
            label="把选中的豆点改成"
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
