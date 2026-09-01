import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError, apiSend } from '../api/client';
import { useApiMutation } from '../api/hooks';
import type { BatchOut, SmartExtractOut } from '../api/types';
import { formatChanges } from '../lib/qty';
import { useToast } from '../state/ToastContext';
import { useEffectiveCatalog } from '../state/useEffectiveCatalog';
import Modal from './Modal';
import VipBadge from './VipBadge';

type Sign = '+' | '-';

/** A row in the confirmation table. The model fills these in; the user owns them. */
interface EditRow {
  /** Stable across edits so React keys survive reordering and deletion. */
  id: number;
  code: string;
  sign: Sign;
  /** Kept as a string so a half-typed value is not clobbered mid-keystroke. */
  qty: string;
  /** Which part of the sentence produced this row. Empty for rows the user added. */
  source: string;
}

const QTY_RE = /^\d+$/;

export default function SmartControlDialog({ onClose }: { onClose: () => void }) {
  const { show } = useToast();
  const { byCode } = useEffectiveCatalog();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<EditRow[] | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [pending, setPending] = useState(false);
  const nextId = useRef(1);

  const apply = useApiMutation((body: { mode: 'add' | 'deduct'; text: string }) =>
    apiSend<BatchOut>('POST', '/api/inventory/batch', body),
  );

  function makeRow(code: string, delta: number, source: string): EditRow {
    return {
      id: nextId.current++,
      code,
      sign: delta < 0 ? '-' : '+',
      qty: String(Math.abs(delta)),
      source,
    };
  }

  async function extract() {
    setPending(true);
    try {
      const res = await apiSend<SmartExtractOut>('POST', '/api/smart/extract', { text });
      setRows(res.lines.map((l) => makeRow(l.code, l.delta, l.source ?? '')));
      setUnresolved(res.unresolved ?? []);
      setModel(res.model ?? '');
      if (res.lines.length === 0) show('没有识别出色号变动，可以手动加一行');
    } catch (err) {
      show(err instanceof ApiError ? err.detail : '识别失败，请稍后再试');
    } finally {
      setPending(false);
    }
  }

  function patch(id: number, change: Partial<EditRow>) {
    setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, ...change } : r)) ?? prev);
  }

  function addRow() {
    setRows((prev) => [...(prev ?? []), makeRow('', 0, '')]);
  }

  function removeRow(id: number) {
    setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev);
  }

  /** '' when the row is fine, otherwise why it is not. */
  function rowError(r: EditRow): string {
    const code = r.code.trim().toUpperCase();
    if (!code) return '请填色号';
    if (!byCode.has(code)) return '色号不存在';
    if (!QTY_RE.test(r.qty.trim())) return '数量应为正整数';
    if (Number(r.qty) <= 0) return '数量应大于 0';
    return '';
  }

  const list = rows ?? [];
  const canSubmit = list.length > 0 && list.every((r) => rowError(r) === '');

  async function submit() {
    // Adds and deducts go as two separate batch operations so each lands in the
    // history with the right sign and stays independently undoable.
    const signed = list.map((r) => ({
      code: r.code.trim().toUpperCase(),
      qty: Number(r.qty),
      sign: r.sign,
    }));
    const changes = [];
    for (const [mode, sign] of [
      ['add', '+'],
      ['deduct', '-'],
    ] as const) {
      const group = signed.filter((r) => r.sign === sign);
      if (group.length === 0) continue;
      const body = group.map((r) => `${r.code},${r.qty}`).join('\n');
      const res = await apply.mutateAsync({ mode, text: body });
      if (!res.applied) {
        show('提交失败，请检查识别结果');
        return;
      }
      changes.push(...res.changes);
    }
    show(formatChanges(changes));
    onClose();
  }

  return (
    <Modal
      title="智能管控"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" disabled={!text.trim() || pending} onClick={() => void extract()}>
            {pending ? '识别中…' : '识别'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canSubmit || apply.isPending}
            onClick={() => void submit()}
          >
            确认并提交
          </button>
        </>
      }
    >
      <div className="vip-block-head">
        <VipBadge />
        <span>用一句话增减豆仓</span>
      </div>
      <label htmlFor="smart-text">自然语言输入，例如「A1 补 200，B3 用掉了 50」</label>
      <textarea
        id="smart-text"
        aria-label="自然语言输入"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {rows && (
        <>
          <p className="muted">
            <Sparkles size={14} aria-hidden="true" /> 识别结果可以直接改，确认无误后再提交
            {model && <span className="model-tag">{model}</span>}
          </p>

          <table aria-label="识别结果" className="preview smart-edit">
            <thead>
              <tr>
                <th>色号</th>
                <th>增减</th>
                <th>数量</th>
                <th>依据</th>
                <th>
                  <span className="visually-hidden">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => {
                const err = rowError(r);
                return (
                  <tr key={r.id} className={err ? 'bad' : undefined}>
                    <td>
                      <input
                        size={1}
                        className="cell-code"
                        aria-label={`第 ${i + 1} 行 色号`}
                        value={r.code}
                        onChange={(e) => patch(r.id, { code: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="cell-sign"
                        aria-label={`第 ${i + 1} 行 增减`}
                        value={r.sign}
                        onChange={(e) => patch(r.id, { sign: e.target.value as Sign })}
                      >
                        <option value="+">+ 增加</option>
                        <option value="-">− 减少</option>
                      </select>
                    </td>
                    <td>
                      <input
                        size={1}
                        inputMode="numeric"
                        className="cell-qty"
                        aria-label={`第 ${i + 1} 行 数量`}
                        value={r.qty}
                        onChange={(e) => patch(r.id, { qty: e.target.value })}
                      />
                    </td>
                    <td className="muted cell-source">{err || r.source}</td>
                    <td>
                      <button
                        type="button"
                        className="ghost icon-only"
                        aria-label={`删除第 ${i + 1} 行`}
                        onClick={() => removeRow(r.id)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <button type="button" className="ghost add-row" onClick={addRow}>
            <Plus size={14} aria-hidden="true" />
            添加一行
          </button>

          {unresolved.length > 0 && <p className="muted">未能识别：{unresolved.join('、')}</p>}
        </>
      )}
    </Modal>
  );
}
