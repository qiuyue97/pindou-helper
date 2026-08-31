import { useState, type KeyboardEvent } from 'react';
import { apiSend } from '../api/client';
import { useApiMutation, useInventory } from '../api/hooks';
import type { ChangesOut } from '../api/types';
import { formatChanges, qtyTier } from '../lib/qty';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { useEffectiveCatalog } from '../state/useEffectiveCatalog';
import Swatch from './Swatch';

export default function InventoryTable() {
  const { me } = useAuth();
  const { show } = useToast();
  const { byCode } = useEffectiveCatalog();
  const { data: rows, isLoading } = useInventory();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const threshold = me?.threshold ?? 0;

  const setQty = useApiMutation((v: { code: string; quantity: number }) =>
    apiSend<ChangesOut>('PUT', `/api/inventory/${encodeURIComponent(v.code)}`, {
      quantity: v.quantity,
    }),
  );
  const removeRow = useApiMutation((code: string) =>
    apiSend<ChangesOut>('DELETE', `/api/inventory/${encodeURIComponent(code)}`),
  );

  function startEdit(code: string, quantity: number) {
    setEditing(code);
    setDraft(String(quantity));
  }

  async function commit(code: string) {
    if (editing !== code) return;
    const value = Number(draft);
    setEditing(null);
    if (draft.trim() === '' || !Number.isInteger(value)) {
      show('数量应为整数');
      return;
    }
    const res = await setQty.mutateAsync({ code, quantity: value });
    show(formatChanges(res.changes));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, code: string) {
    if (e.key === 'Enter') void commit(code);
    if (e.key === 'Escape') setEditing(null);
  }

  async function onDelete(code: string) {
    const res = await removeRow.mutateAsync(code);
    show(formatChanges(res.changes));
  }

  if (isLoading) return <p>加载中…</p>;
  if (!rows || rows.length === 0) return <p>还没有库存记录，先添加色号或批量补货。</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>色号</th>
          <th>系列</th>
          <th>颜色</th>
          <th>数量</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const tier = qtyTier(row.quantity, threshold);
          return (
            <tr key={row.code}>
              <td>{row.code}</td>
              <td>{byCode.get(row.code)?.series ?? '—'}</td>
              <td>
                <Swatch code={row.code} />
              </td>
              <td>
                {editing === row.code ? (
                  <input
                    autoFocus
                    aria-label={`${row.code} 数量`}
                    className="qty-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => onKeyDown(e, row.code)}
                    onBlur={() => void commit(row.code)}
                  />
                ) : (
                  <button
                    type="button"
                    className={`qty qty-${tier}`}
                    data-tier={tier}
                    onClick={() => startEdit(row.code, row.quantity)}
                  >
                    {row.quantity}
                  </button>
                )}
              </td>
              <td className="muted">{new Date(row.updated_at).toLocaleString('zh-CN')}</td>
              <td>
                <button type="button" onClick={() => void onDelete(row.code)}>
                  删除
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
