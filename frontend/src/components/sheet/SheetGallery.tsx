import { useQueryClient } from '@tanstack/react-query';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiSend } from '../../api/client';
import type { Sheet } from '../../api/types';
import { moveTo } from '../../lib/reorder';
import { useToast } from '../../state/ToastContext';

const STATUS_TEXT: Record<Sheet['status'], string> = {
  pending: '排队中',
  running: '识别中',
  ready: '待确认网格',
  done: '已完成',
  failed: '失败',
};

/** 手指按住多久算「我要拖它」而不是「我要滑页面」。 */
const HOLD_MS = 350;
/** 按住期间手指晃出这么多像素就算滑动，取消长按。 */
const HOLD_SLOP = 8;
/** 鼠标要拖出这么多像素才算拖动，否则算点击。 */
const MOUSE_SLOP = 5;

/**
 * 我的图纸：缩略图墙。
 *
 * 原来是一列纯文字链接（`#10 65×65 已完成 2026/9/4`）。图纸这东西**是靠看认出来
 * 的**——十张 65×65 的行列数一模一样，日期也记不住，光靠 id 根本分不出哪张是哪张。
 * 所以这里以缩略图为主，名字、状态、尺寸都退成注脚。
 *
 * 缩略图走 `/thumb` 不走 `/image`：原图是几 MB 的生成器导出，一次十几张，手机上
 * 光下载就得半天。
 *
 * 每行几个由**可用宽度**决定（auto-fill + minmax），不写死断点：这一页在手机上
 * 是两列，平板三四列，桌面六列，都是同一条规则算出来的。
 *
 * 拖拽排序在触摸端要过一道长按：卡片本身得能滑动页面（一屏放不下十几张），所以
 * 不能像框选那样直接 `touch-action: none`。按住不动 350ms 才接管手势——那时浏览器
 * 还没开始滚，接管得过来；中途手指一晃就当滑动放掉。鼠标没有这个冲突，拖出 5px
 * 就开始。左上角那个把手是**确定能拖**的那条路，它自己是 `touch-action: none`。
 */
export default function SheetGallery({ sheets }: { sheets: Sheet[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const gridRef = useRef<HTMLDivElement>(null);

  /** 拖动中的临时顺序。null = 没在拖，直接用服务端给的顺序。 */
  const [order, setOrder] = useState<number[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const byId = useMemo(() => new Map(sheets.map((s) => [s.id, s])), [sheets]);
  const ids = useMemo(() => sheets.map((s) => s.id), [sheets]);
  const shown = (order ?? ids).map((id) => byId.get(id)).filter((s): s is Sheet => !!s);

  // --- 拖拽 ---
  //
  // 「正在拖谁」放 ref 不放 state：同一个事件里 beginDrag 之后马上就要用它去算新
  // 顺序，state 那时候还是旧值。`dragging` 那份只负责让被拖的卡片变个样子。
  const hold = useRef<number | null>(null);
  const start = useRef<{ id: number; x: number; y: number; touch: boolean } | null>(null);
  const dragId = useRef<number | null>(null);
  const live = useRef<number[] | null>(null);
  const moved = useRef(false);
  const suppressClick = useRef(false);

  function cancelHold() {
    if (hold.current !== null) {
      window.clearTimeout(hold.current);
      hold.current = null;
    }
  }

  /** 指针底下压着哪张卡片。 */
  function idAt(e: React.PointerEvent): number | null {
    const hit = (e.target as HTMLElement).closest?.('[data-sheet-id]') as HTMLElement | null;
    return hit ? Number(hit.dataset.sheetId) : null;
  }

  function beginDrag(id: number) {
    cancelHold();
    dragId.current = id;
    live.current = ids.slice();
    setOrder(live.current);
    setDragging(id);
  }

  function onPointerDown(e: React.PointerEvent, viaHandle = false) {
    const id = idAt(e);
    if (id === null || editing !== null) return;
    // 触摸的指针会被浏览器隐式捕获在起手那个元素上，之后每个 move 的 target 都还是
    // 它——拖过别的卡片一张都认不出来。放掉它。
    const el = e.target as Element;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);

    moved.current = false;
    suppressClick.current = false;
    start.current = { id, x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch' };
    // 把手是「确定要拖」的意思，按住就走
    if (viaHandle) return beginDrag(id);
    // 鼠标不用等：它和滚页面没有冲突，拖出 MOUSE_SLOP 就开始（在 move 里判）
    if (e.pointerType !== 'touch') return;
    hold.current = window.setTimeout(() => beginDrag(id), HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    const from = start.current;
    if (!from) return;

    if (dragId.current === null) {
      const far = Math.hypot(e.clientX - from.x, e.clientY - from.y);
      // 手指一晃就是要滑页面，放掉长按——这一屏放不下十几张卡片，滑动比拖动常用
      if (from.touch) {
        if (far > HOLD_SLOP) {
          cancelHold();
          start.current = null;
        }
        return;
      }
      if (far <= MOUSE_SLOP) return;
      beginDrag(from.id);
    }

    const id = dragId.current;
    const over = idAt(e);
    if (id === null || over === null || over === id) return;
    const next = moveTo(live.current ?? ids, id, over);
    if (next !== live.current) {
      moved.current = true;
      live.current = next;
      setOrder(next);
    }
  }

  function onPointerUp() {
    cancelHold();
    const dragged = dragId.current;
    const next = live.current;
    start.current = null;
    dragId.current = null;
    live.current = null;
    setDragging(null);
    if (dragged !== null && moved.current && next) {
      suppressClick.current = true; // 松手还会补一个 click，别让它把图纸打开
      void saveOrder(next);
    } else {
      setOrder(null);
    }
    moved.current = false;
  }

  // 长按接管之后，第一下 touchmove 必须 preventDefault，否则 iOS 照样把这一下
  // 当成滑页面（touch-action 不是 none，浏览器还留着那个选择权）。React 挂的是
  // 被动监听，preventDefault 无效，只能自己挂一个。
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (dragging !== null) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [dragging]);

  async function saveOrder(next: number[]) {
    try {
      await apiSend('PUT', '/api/sheets/order', { ids: next });
      await queryClient.invalidateQueries({ queryKey: ['sheets'] });
    } catch (e) {
      show(e instanceof Error ? e.message : '排序没保存上');
    } finally {
      setOrder(null); // 不管成没成，都回到服务端那一份为准
    }
  }

  async function rename(id: number, name: string) {
    setEditing(null);
    try {
      await apiSend('PATCH', `/api/sheets/${id}/name`, { name });
      await queryClient.invalidateQueries({ queryKey: ['sheets'] });
    } catch (e) {
      show(e instanceof Error ? e.message : '改名失败');
    }
  }

  async function remove(id: number) {
    setConfirming(null);
    try {
      await apiSend('DELETE', `/api/sheets/${id}`);
      await queryClient.invalidateQueries({ queryKey: ['sheets'] });
    } catch (e) {
      show(e instanceof Error ? e.message : '删除失败');
    }
  }

  if (sheets.length === 0) return null;
  // 两类分开列。识别来的和照片转的**能做的事不一样**（后者不逐格改色），混在一起
  // 光看缩略图分不出来——点进去才发现界面不一样，比多一个小标题烦人得多。
  // 认不出来的一律当识别——老记录（加 kind 之前存的）没有这个字段。
  const kindOf = (s: Sheet) => (s.kind === 'generate' ? 'generate' : 'recognise');
  const groups = [
    { kind: 'recognise' as const, title: '识别的图纸' },
    { kind: 'generate' as const, title: '图片转的图纸' },
  ].filter((g) => shown.some((s) => kindOf(s) === g.kind));

  return (
    <section className="sheet-gallery">
      <h3>我的图纸</h3>
      <p className="muted">点开继续；按住可以拖动排序。</p>
      {/* biome-ignore lint/a11y/useKeyboardEvents: 卡片里有真的按钮和链接走键盘，
          这一层只是叠加的拖动手势 */}
      <div
        ref={gridRef}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            e.preventDefault();
            suppressClick.current = false;
          }
        }}
      >
        {groups.map((g) => (
          <div key={g.kind} className="sheet-group">
            {/* 只有两类都有的时候才需要小标题——只有一类时它是废话 */}
            {groups.length > 1 && <h4>{g.title}</h4>}
            <ul className="sheet-grid">
              {shown.filter((s) => kindOf(s) === g.kind).map((s) => (

          <li
            key={s.id}
            data-sheet-id={s.id}
            className={`sheet-card${dragging === s.id ? ' dragging' : ''}`}
          >
            <button
              type="button"
              className="sheet-card-open"
              aria-label={`打开 ${s.name || `#${s.id}`}`}
              onClick={() => navigate(`/sheet/${s.id}`)}
            >
              <img
                className="sheet-thumb"
                src={`/api/sheets/${s.id}/thumb`}
                alt=""
                loading="lazy"
                draggable={false}
              />
            </button>

            <span
              className="sheet-card-grip"
              aria-label={`拖动排序 ${s.name || `#${s.id}`}`}
              onPointerDown={(e) => onPointerDown(e, true)}
            >
              <GripVertical size={15} aria-hidden="true" />
            </span>

            <div className="sheet-card-body">
              {editing === s.id ? (
                <input
                  className="sheet-name-input"
                  aria-label={`给 #${s.id} 起名字`}
                  defaultValue={s.name}
                  maxLength={80}
                  // biome-ignore lint/a11y/noAutofocus: 点了「改名」就是要立刻打字
                  autoFocus
                  onBlur={(e) => void rename(s.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void rename(s.id, e.currentTarget.value);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <strong className="sheet-card-name" title={s.name || `#${s.id}`}>
                  {s.name || `#${s.id}`}
                </strong>
              )}
              <span className="sheet-card-meta">
                <span className={`sheet-status s-${s.status}`}>{STATUS_TEXT[s.status]}</span>
                {s.rows > 0 && s.cols > 0 && (
                  <span className="muted">
                    {s.rows}×{s.cols}
                  </span>
                )}
              </span>
              <time className="muted" dateTime={s.created_at}>
                {new Date(s.created_at).toLocaleDateString()}
              </time>
            </div>

            {confirming === s.id ? (
              <div className="sheet-card-confirm">
                <span>删掉这张？</span>
                <button type="button" className="danger" onClick={() => void remove(s.id)}>
                  删除
                </button>
                <button type="button" className="ghost" onClick={() => setConfirming(null)}>
                  取消
                </button>
              </div>
            ) : (
              <div className="sheet-card-actions">
                <button
                  type="button"
                  className="ghost"
                  aria-label={`改名 #${s.id}`}
                  onClick={() => setEditing(s.id)}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ghost"
                  aria-label={`删除 #${s.id}`}
                  onClick={() => setConfirming(s.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
