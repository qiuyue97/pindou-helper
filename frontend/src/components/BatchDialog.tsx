import { useMemo, useRef, useState } from 'react';
import { apiSend } from '../api/client';
import { useApiMutation, useInventory } from '../api/hooks';
import type { BatchLineResult, BatchOut } from '../api/types';
import { parseLines } from '../lib/parseLines';
import { formatChanges } from '../lib/qty';
import { useToast } from '../state/ToastContext';
import { useEffectiveCatalog } from '../state/useEffectiveCatalog';
import Modal from './Modal';

type Status = 'ok' | 'format_error' | 'bad_quantity' | 'code_not_found';

interface PreviewRow {
  lineNo: number;
  code: string | null;
  qty: number | null;
  status: Status;
  advisory: string;
}

const STATUS_TEXT: Record<Status, string> = {
  ok: '正常',
  format_error: '格式错误',
  bad_quantity: '数量应为正整数',
  code_not_found: '色号不存在',
};

export default function BatchDialog({
  mode,
  initialText,
  onClose,
  onSubmit,
}: {
  mode: 'add' | 'deduct';
  initialText?: string;
  onClose: () => void;
  onSubmit?: (text: string) => Promise<void>;
}) {
  const { show } = useToast();
  const { byCode } = useEffectiveCatalog();
  const { data: inventory } = useInventory();
  const [text, setText] = useState(initialText ?? '');
  const [serverResults, setServerResults] = useState<BatchLineResult[] | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const apply = useApiMutation((v: { mode: 'add' | 'deduct'; text: string }) =>
    apiSend<BatchOut>('POST', '/api/inventory/batch', v),
  );

  const rows: PreviewRow[] = useMemo(() => {
    const have = new Map((inventory ?? []).map((r) => [r.code, r.quantity]));
    return parseLines(text).map((l) => {
      let status: Status = l.status;
      if (status === 'ok' && (l.code === null || !byCode.has(l.code))) status = 'code_not_found';
      let advisory = '';
      if (status === 'ok' && mode === 'deduct' && l.code && l.qty !== null) {
        if ((have.get(l.code) ?? 0) - l.qty < 0) advisory = '将扣成负数';
      }
      return { lineNo: l.lineNo, code: l.code, qty: l.qty, status, advisory };
    });
  }, [text, byCode, inventory, mode]);

  const canApply = rows.length > 0 && rows.every((r) => r.status === 'ok');

  function selectLine(lineNo: number) {
    const ta = taRef.current;
    if (!ta) return;
    const lines = ta.value.split('\n');
    const start = lines.slice(0, lineNo - 1).reduce((n, l) => n + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(start, start + (lines[lineNo - 1]?.length ?? 0));
  }

  async function doApply() {
    if (onSubmit) {
      await onSubmit(text);
      onClose();
      return;
    }
    const res = await apply.mutateAsync({ mode, text });
    if (!res.applied) {
      setServerResults(res.results);
      return;
    }
    show(formatChanges(res.changes));
    onClose();
  }

  const shown: PreviewRow[] =
    serverResults?.map((r) => ({
      lineNo: r.line,
      code: r.code,
      qty: r.qty,
      status: r.status,
      advisory: '',
    })) ?? rows;

  return (
    <Modal
      title={mode === 'add' ? '批量补货' : '批量扣减'}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canApply}
            onClick={() => void doApply()}
          >
            应用
          </button>
        </>
      }
    >
      <label htmlFor="batch-text">
        每行一条，格式 <code>色号,数量</code>（中文逗号或空格也可以）
      </label>
      <textarea
        id="batch-text"
        aria-label="批量输入"
        ref={taRef}
        rows={8}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setServerResults(null);
        }}
      />

      {shown.length > 0 && (
        <table aria-label="解析预览" className="preview">
          <thead>
            <tr>
              <th>行</th>
              <th>色号</th>
              <th>数量</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.lineNo}
                className={r.status === 'ok' ? undefined : 'bad'}
                onClick={() => selectLine(r.lineNo)}
              >
                <td>{r.lineNo}</td>
                <td>{r.code ?? '—'}</td>
                <td>{r.qty ?? '—'}</td>
                <td>{r.advisory || STATUS_TEXT[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
