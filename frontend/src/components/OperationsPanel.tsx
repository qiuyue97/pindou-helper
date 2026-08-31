import { useEffect, useState } from 'react';
import { apiSend } from '../api/client';
import { useApiMutation, useOperations } from '../api/hooks';
import type { Change, ChangesOut, OperationRow } from '../api/types';
import { parseLines } from '../lib/parseLines';
import { formatChanges } from '../lib/qty';
import { useToast } from '../state/ToastContext';
import BatchDialog from './BatchDialog';
import ImpactDialog from './ImpactDialog';

const EDITABLE_BATCH = new Set(['batch_add', 'batch_deduct']);

function rawOf(op: OperationRow): string {
  return op.entries.map((e) => `${e.code},${e.amount ?? 0}`).join('\n');
}

export default function OperationsPanel() {
  const { show } = useToast();
  const { data: ops, isLoading } = useOperations();
  const [pendingVoid, setPendingVoid] = useState<{ op: OperationRow; changes: Change[] } | null>(
    null,
  );
  const [editing, setEditing] = useState<OperationRow | null>(null);

  const previewVoid = useApiMutation(
    (seq: number) => apiSend<ChangesOut>('POST', `/api/operations/${seq}/impact`, { mode: 'void' }),
    { invalidate: false },
  );
  const voidOp = useApiMutation((seq: number) =>
    apiSend<ChangesOut>('POST', `/api/operations/${seq}/void`),
  );
  const restoreOp = useApiMutation((seq: number) =>
    apiSend<ChangesOut>('POST', `/api/operations/${seq}/restore`),
  );
  const patchOp = useApiMutation((v: { seq: number; type: string; payload: unknown }) =>
    apiSend<ChangesOut>('PATCH', `/api/operations/${v.seq}`, { type: v.type, payload: v.payload }),
  );

  async function askVoid(op: OperationRow) {
    const res = await previewVoid.mutateAsync(op.seq);
    setPendingVoid({ op, changes: res.changes });
  }

  async function confirmVoid() {
    if (!pendingVoid) return;
    const res = await voidOp.mutateAsync(pendingVoid.op.seq);
    setPendingVoid(null);
    show(formatChanges(res.changes));
  }

  async function doRestore(op: OperationRow) {
    const res = await restoreOp.mutateAsync(op.seq);
    show(formatChanges(res.changes));
  }

  async function saveEdit(text: string) {
    if (!editing) return;
    const lines = parseLines(text)
      .filter((l) => l.status === 'ok' && l.code && l.qty !== null)
      .map((l) => ({ code: l.code as string, qty: l.qty as number }));
    const res = await patchOp.mutateAsync({
      seq: editing.seq,
      type: editing.type,
      payload: { raw: text, lines },
    });
    setEditing(null);
    show(formatChanges(res.changes));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (typing || pendingVoid || editing || !ops) return;
      e.preventDefault();
      if (e.shiftKey) {
        const target = ops.find((o) => o.voided);
        if (target) void doRestore(target);
      } else {
        const target = ops.find((o) => !o.voided);
        if (target) void askVoid(target);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ops, pendingVoid, editing]);

  if (isLoading) return <p>加载中…</p>;
  if (!ops || ops.length === 0) return <p>还没有任何操作记录。</p>;

  return (
    <>
      <ul className="oplist">
        {ops.map((op) => (
          <li key={op.seq} className={op.voided ? 'voided' : undefined}>
            <span className="opseq">#{op.seq}</span>
            <time>{new Date(op.created_at).toLocaleString('zh-CN')}</time>
            <span className="opsummary">{op.summary}</span>
            {op.edited_at && <span className="tag">已编辑</span>}
            <span className="opactions">
              {op.voided ? (
                <button type="button" onClick={() => void doRestore(op)}>
                  恢复
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => void askVoid(op)}>
                    撤销
                  </button>
                  {EDITABLE_BATCH.has(op.type) && (
                    <button type="button" onClick={() => setEditing(op)}>
                      编辑
                    </button>
                  )}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {pendingVoid && (
        <ImpactDialog
          title={`撤销 #${pendingVoid.op.seq}`}
          changes={pendingVoid.changes}
          confirmLabel="确认撤销"
          onConfirm={() => void confirmVoid()}
          onClose={() => setPendingVoid(null)}
        />
      )}

      {editing && (
        <BatchDialog
          mode={editing.type === 'batch_add' ? 'add' : 'deduct'}
          initialText={rawOf(editing)}
          onClose={() => setEditing(null)}
          onSubmit={saveEdit}
        />
      )}
    </>
  );
}
