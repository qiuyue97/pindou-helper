import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CountRow, Sheet } from '../../api/types';
import { type Rect, cellRect } from '../../lib/sheetGeometry';
import { BLANK_CODE, groupByCode } from '../../lib/sheetSort';
import CodeSheet from './CodeSheet';

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
  /** 整体改色号：这个色号名下的格子全部跟着变（含手工挪进来的） */
  onRecode: (code: string, to: string) => void;
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
 *   左边改色号 -> 这个色号名下**所有**豆点跟着改（含手工挪进来的那些）
 *   左边改数量 -> 只改「图纸说有多少」，不动任何豆点
 *   右边改豆点 -> 那几个豆点移出当前色号，进入目标色号；目标色号图例里没有的话
 *                 自动新开一条，标绿（那是用户确认过的，不是错误）
 *
 * 改动是**一次性**的：改完就是新的现状，和一开始就识别成这样没有区别。所以豆点
 * 上不留任何「这一格被改过」的标记，也不给回退渠道——要改回去就再改一次色号。
 */
export default function SheetReview({
  sheet,
  onRecode,
  onPatchPrior,
  onPatchCells,
}: SheetReviewProps) {
  // 空格自己单列一行。它不在 counts 里（空格不是色号，不进任何统计），可要是
  // 不列出来，被识别成空白的格子就再也选不中、改不回去了。
  const blanks = useMemo(() => countBlanks(sheet), [sheet]);
  const rows = useMemo(
    () =>
      blanks > 0
        ? [
            ...sheet.counts,
            {
              code: BLANK_CODE,
              sheet: blanks,
              prior: null,
              classes: [],
              level: 'ok' as const,
              custom: false,
            },
          ]
        : sheet.counts,
    [sheet.counts, blanks],
  );
  const [active, setActive] = useState<string | null>(rows[0]?.code ?? null);
  const current = rows.find((r) => r.code === active) ?? rows[0] ?? null;

  return (
    <div className="sheet-review">
      <CodeColumn
        rows={rows}
        active={current?.code ?? null}
        hasPrior={Object.keys(sheet.prior).length > 0}
        palette={sheet.palette}
        allowBlank={sheet.has_blanks}
        onSelect={setActive}
        onRename={(row, code) => onRecode(row.code, code)}
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
  allowBlank,
  onSelect,
  onRename,
  onCount,
}: {
  rows: CountRow[];
  active: string | null;
  hasPrior: boolean;
  palette: Sheet['palette'];
  allowBlank: boolean;
  onSelect: (code: string) => void;
  onRename: (row: CountRow, code: string) => void;
  onCount: (row: CountRow, n: number | null) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const edited = rows.find((r) => r.code === editing) ?? null;

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
              <strong>{row.code === BLANK_CODE ? '空白格' : row.code}</strong>
            </button>

            {/* 按钮**不消失**。原来点一下按钮就地变成输入框，界面在手底下变形，
                用户还得重新找刚才点的地方；现在它一直在，面板盖在上面。 */}
            <div className="code-row-edit">
              <button
                type="button"
                className="linklike"
                aria-label={`改色号 ${row.code}`}
                aria-haspopup="dialog"
                aria-expanded={editing === row.code}
                onClick={() => setEditing(row.code)}
              >
                改色号
              </button>
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
      {edited && (
        <CodeSheet
          title={`把 ${edited.code === BLANK_CODE ? '空白格' : edited.code} 整类改成`}
          value={edited.code}
          scope={palette}
          allowBlank={allowBlank && edited.code !== BLANK_CODE}
          onPick={(code) => {
            setEditing(null);
            onRename(edited, code);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </ul>
  );
}

/** 某个色号名下的全部格子（扁平下标）。含逐格覆盖进来的——它们没有类。 */
function codeCells(sheet: Sheet, code: string): number[] {
  const byCode = new Map(groupByCode(sheet.classes).map((g) => [g.code, g]));
  const own = new Set(byCode.get(code)?.cells ?? []);
  for (const [key, over] of Object.entries(sheet.overrides)) {
    const [r, c] = key.split(',').map(Number);
    const flat = r! * sheet.cols + c!;
    if (over === code) own.add(flat);
    else own.delete(flat); // 被改去别的色号了，不再属于这里
  }
  return [...own].sort((a, b) => a - b);
}

/**
 * 所有空格。两个来源：检测出来就是空的（label -1），和人工标成空白的。
 * 它们是同一回事，合在一起。
 */
function blankCells(sheet: Sheet): number[] {
  const coded = new Set(sheet.classes.filter((c) => c.code !== BLANK_CODE).map((c) => c.klass));
  const out: number[] = [];
  for (let flat = 0; flat < sheet.rows * sheet.cols; flat += 1) {
    const r = Math.floor(flat / sheet.cols);
    const c = flat % sheet.cols;
    const over = sheet.overrides[`${r},${c}`];
    if (over !== undefined) {
      if (over === BLANK_CODE) out.push(flat);
      continue;
    }
    const k = sheet.labels[flat];
    if (k === undefined || k < 0 || !coded.has(k)) out.push(flat);
  }
  return out;
}

function countBlanks(sheet: Sheet): number {
  return blankCells(sheet).length;
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
  const [picking, setPicking] = useState(false);
  const { cols } = sheet;

  // 按住拖选。单击某格照旧是勾/取消；按住往外拖，把落点之间的格子**按阅读顺序**
  // 一整段处理（换行自动接下一行行首）。方向由起手那格决定：起手那格没选中就
  // 整段选上，起手那格已选中就整段取消——和文件管理器框选一个套路。移动端同理，
  // 所以拖选层要 touch-action: none，不然一拖变成滚页面。
  const anchor = useRef<number | null>(null);
  const mode = useRef<'add' | 'remove'>('add');
  const moved = useRef(false);
  const suppressClick = useRef(false);
  const [dragSet, setDragSet] = useState<Set<number> | null>(null);
  /** 拖选区另存一份在 ref 里：手指滑出格子区再抬起时，收尾的是挂在 window 上的
   *  兜底监听，它读不到 state 的最新值。 */
  const dragRef = useRef<Set<number> | null>(null);
  function putDrag(s: Set<number> | null) {
    dragRef.current = s;
    setDragSet(s);
  }

  /** 事件当前压在哪一格上。不捕获指针，所以 pointermove 的 target 就是指针下的
   *  那个格子（拖过谁就是谁），不用 elementFromPoint。 */
  function flatOf(e: React.PointerEvent): number | null {
    const hit = (e.target as HTMLElement).closest?.('[data-flat]') as HTMLElement | null;
    return hit ? Number(hit.dataset.flat) : null;
  }

  // 这个色号名下的全部格子。含逐格覆盖进来的——它们没有类，但确实归这个色号。
  const cells = useMemo(
    () => (row.code === BLANK_CODE ? blankCells(sheet) : codeCells(sheet, row.code)),
    [sheet, row.code],
  );

  const pageCells = useMemo(
    () => cells.slice(page * PER_PAGE, (page + 1) * PER_PAGE),
    [cells, page],
  );
  const pageCount = Math.max(1, Math.ceil(cells.length / PER_PAGE));
  const gridRows = Math.max(1, Math.ceil(pageCells.length / PER_ROW));

  // 原图**只加载一次**，之后每格都是从它上面 drawImage 裁出来的一小块。
  //
  // 之前是在绘制的 effect 里现 new 一个 Image：那个 effect 的依赖里有每次渲染都
  // 新建的数组（cells.slice 的结果），于是每渲染一次就重跑一次——同步 clearRect、
  // 异步等图。原图有好几 MB，加载窗口很长，期间任何一次重渲染都会把刚画好的内容
  // 清掉，结果就是画布**一直是空白的**。
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  // 原图取不到（卷被清过、记录还在）时要说出来。之前是静静地留一块空白画布，
  // 用户只能看到「共 N 个豆点」下面什么都没有，完全不知道发生了什么。
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let alive = true;
    const im = new Image();
    im.onload = () => {
      if (alive) setImg(im);
    };
    im.onerror = () => {
      if (alive) setGone(true);
    };
    im.src = `/api/sheets/${sheet.id}/image`;
    return () => {
      alive = false;
    };
  }, [sheet.id]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    // 图已经在手上了，同步画完——不再有「清了之后等异步」的窗口
    pageCells.forEach((flat, n) => {
      const { sx, sy, sw, sh } = cellRect(
        sheet.rect as Rect,
        sheet.rows,
        sheet.cols,
        Math.floor(flat / cols),
        flat % cols,
      );
      ctx.drawImage(
        img, sx, sy, sw, sh,
        (n % PER_ROW) * TILE, Math.floor(n / PER_ROW) * TILE, TILE, TILE,
      );
    });
  }, [img, pageCells, sheet.rect, sheet.rows, sheet.cols, cols, gridRows]);

  function onPointerDown(e: React.PointerEvent) {
    const flat = flatOf(e);
    if (flat === null) return;
    // 触摸的指针会被浏览器**隐式捕获**到 pointerdown 那个元素上（Pointer Events
    // 规范就是这么定的），于是之后每一个 pointermove 的 target 都还是起手那一格
    // ——手指明明划过了十几格，代码一格都认不出来。这就是手机上「按住有框、
    // 往下拉不出第二个框」的全部原因（鼠标没有隐式捕获，所以电脑上一直是好的）。
    // 放掉捕获，move 才会正常落到指针底下那一格上。
    const el = e.target as Element;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    anchor.current = flat;
    mode.current = picked.has(flat) ? 'remove' : 'add';
    moved.current = false;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (anchor.current === null) return;
    const flat = flatOf(e);
    if (flat === null) return;
    const ai = pageCells.indexOf(anchor.current);
    const bi = pageCells.indexOf(flat);
    if (ai < 0 || bi < 0) return;
    if (bi !== ai) moved.current = true;
    const [lo, hi] = ai < bi ? [ai, bi] : [bi, ai];
    putDrag(new Set(pageCells.slice(lo, hi + 1)));
  }

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (moved.current && drag) {
      setPicked((s) => {
        const next = new Set(s);
        for (const flat of drag) {
          if (mode.current === 'add') next.add(flat);
          else next.delete(flat);
        }
        return next;
      });
      suppressClick.current = true; // 拖完手指抬起还会补一个 click，别让它翻掉最后那格
    }
    anchor.current = null;
    moved.current = false;
    putDrag(null);
  }, []);

  // 放掉隐式捕获之后，手指要是滑出格子区再抬起，容器就收不到 pointerup 了，
  // 拖选会一直卡在半路（选区悬着、下一次按下接着上一次的锚点）。挂 window 上兜底。
  // 容器自己的 pointerup 先跑，跑完 anchor 已经清空，这里就不会重复收一次。
  useEffect(() => {
    const up = () => {
      if (anchor.current !== null) endDrag();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [endDrag]);

  // 拖动预览：起手是「选」就把这一段并上去，是「取消」就把这一段挖掉。
  let sel = picked;
  if (dragSet) {
    sel = new Set(picked);
    for (const flat of dragSet) {
      if (mode.current === 'add') sel.add(flat);
      else sel.delete(flat);
    }
  }
  const list = [...picked].sort((a, b) => a - b);

  return (
    <div className="cell-pane">
      <p className="cell-pane-head">
        <strong>{row.code === BLANK_CODE ? '空白格' : row.code}</strong>
        <span className="muted">共 {cells.length} 个豆点</span>
      </p>

      {gone && (
        <p className="error">
          原图已不存在，看不到豆点缩略图了。识别结果还在，色号照样能改；要重新看图请
          重新上传这张图纸。
        </p>
      )}

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
        {/* biome-ignore lint/a11y/useKeyboardEvents: 每格里有真的 checkbox 走键盘，
            这一层只是叠加的拖选手势 */}
        <div
          className="cell-hits"
          style={{
            gridTemplateColumns: `repeat(${PER_ROW}, 1fr)`,
            gridTemplateRows: `repeat(${gridRows}, 1fr)`,
            touchAction: 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={(e) => {
            if (suppressClick.current) {
              e.stopPropagation();
              e.preventDefault();
              suppressClick.current = false;
            }
          }}
        >
          {pageCells.map((flat) => {
            const r = Math.floor(flat / cols);
            const c = flat % cols;
            const on = sel.has(flat);
            return (
              <span
                key={flat}
                data-flat={flat}
                className={`cell-hit${on ? ' picked' : ''}`}
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
        // 原来这里直接摆一个输入框：手机上一点它，iOS 就把它滚进视野，整页往上跳，
        // 刚数好的豆点全跑没了。改成一个按钮 + 浮层面板，页面纹丝不动。
        <div className="cell-actions">
          <span>已选 {list.length} 个</span>
          <button type="button" className="primary" onClick={() => setPicking(true)}>
            改成…
          </button>
          <button type="button" className="ghost" onClick={() => setPicked(new Set())}>
            取消选择
          </button>
        </div>
      )}

      {picking && (
        <CodeSheet
          title={`把选中的 ${list.length} 个豆点改成`}
          scope={sheet.palette}
          allowBlank={sheet.has_blanks}
          onPick={(code) => {
            setPicking(false);
            onPatchCells(
              list.map((flat) => ({ r: Math.floor(flat / cols), c: flat % cols, code })),
            );
            setPicked(new Set());
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
