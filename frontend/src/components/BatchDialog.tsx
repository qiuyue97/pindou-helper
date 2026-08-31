import { useMemo, useRef, useState } from 'react';
import { apiSend } from '../api/client';
import { useApiMutation, useInventory } from '../api/hooks';
import type { BatchLineResult, BatchOut } from '../api/types';
import { ALL_CODE, isAllCode, scopeCodes } from '../lib/allScope';
import { parseLines } from '../lib/parseLines';
import { formatChanges } from '../lib/qty';
import type { CandidateSet } from '../color/match';
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
  /** For an ALL row: how many codes it expands to. */
  expandsTo?: number;
}

const STATUS_TEXT: Record<Status, string> = {
  ok: '正常',
  format_error: '格式错误',
  bad_quantity: '数量应为正整数',
  code_not_found: '色号不存在',
};

export default function BatchDialog({
  mode,
  scopeSet,
  includeCustom = true,
  initialText,
  onClose,
  onSubmit,
}: {
  mode: 'add' | 'deduct';
  /** Which catalogue an ALL row covers. Comes from the inventory page selector. */
  scopeSet: CandidateSet;
  includeCustom?: boolean;
  initialText?: string;
  onClose: () => void;
  onSubmit?: (text: string) => Promise<void>;
}) {
  const { show } = useToast();
  const { byCode, colors } = useEffectiveCatalog();
  const { data: inventory } = useInventory();
  const [text, setText] = useState(initialText ?? '');
  const [serverResults, setServerResults] = useState<BatchLineResult[] | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const allCodes = useMemo(
    () => scopeCodes(colors, scopeSet, includeCustom),
    [colors, scopeSet, includeCustom],
  );

  const apply = useApiMutation(
    (v: { mode: 'add' | 'deduct'; text: string; scope: { set: CandidateSet; include_custom: boolean } }) =>
      apiSend<BatchOut>('POST', '/api/inventory/batch', v),
  );

  const rows: PreviewRow[] = useMemo(() => {
    const have = new Map((inventory ?? []).map((r) => [r.code, r.quantity]));
    return parseLines(text).map((l) => {
      // ALL is a wildcard, not a catalogue code — never flag it as unknown.
      if (l.status === 'ok' && isAllCode(l.code)) {
        return {
          lineNo: l.lineNo,
          code: ALL_CODE,
          qty: l.qty,
          status: 'ok' as Status,
          advisory: '',
          expandsTo: allCodes.length,
        };
      }
      let status: Status = l.status;
      if (status === 'ok' && (l.code === null || !byCode.has(l.code))) status = 'code_not_found';
      let advisory = '';
      if (status === 'ok' && mode === 'deduct' && l.code && l.qty !== null) {
        if ((have.get(l.code) ?? 0) - l.qty < 0) advisory = '将扣成负数';
      }
      return { lineNo: l.lineNo, code: l.code, qty: l.qty, status, advisory };
    });
  }, [text, byCode, inventory, mode, allCodes]);

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
    const res = await apply.mutateAsync({
      mode,
      text,
      scope: { set: scopeSet, include_custom: includeCustom },
    });
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
      <p className="muted">
        用 <code>ALL,100</code> 表示当前 {scopeSet} 色全部各
        {mode === 'add' ? '补' : '扣'} 100；可以和普通行混用，写在后面的行会继续累加。
      </p>
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
                <td>
                  {r.expandsTo !== undefined
                    ? `${r.expandsTo} 个色号`
                    : r.advisory || STATUS_TEXT[r.status]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
