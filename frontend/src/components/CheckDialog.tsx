import { useState } from 'react';
import { apiSend } from '../api/client';
import { useApiMutation } from '../api/hooks';
import type { CheckLineResult, CheckOut } from '../api/types';
import Modal from './Modal';

function describeResult(r: CheckLineResult): string {
  switch (r.status) {
    case 'enough':
      return `足够（现有 ${r.have}）`;
    case 'short':
      return `还差 ${(r.need ?? 0) - (r.have ?? 0)}（现有 ${r.have}）`;
    case 'unknown_code':
      return '色号不存在';
    case 'bad_quantity':
      return '数量应为正整数';
    default:
      return '格式错误';
  }
}

export default function CheckDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<CheckLineResult[] | null>(null);

  const check = useApiMutation(
    (body: { text: string }) => apiSend<CheckOut>('POST', '/api/inventory/check', body),
    { invalidate: false },
  );

  async function run() {
    const res = await check.mutateAsync({ text });
    setResults(res.results);
  }

  return (
    <Modal
      title="需求核对"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="primary" onClick={() => void run()}>
            核对
          </button>
        </>
      }
    >
      <label htmlFor="check-text">
        每行一条，格式 <code>色号,数量</code>
      </label>
      <textarea
        id="check-text"
        aria-label="需求清单"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {results && (
        <table aria-label="核对结果" className="preview">
          <thead>
            <tr>
              <th>行</th>
              <th>色号</th>
              <th>需求</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.line} className={r.status === 'enough' ? undefined : 'bad'}>
                <td>{r.line}</td>
                <td>{r.code ?? '—'}</td>
                <td>{r.need ?? '—'}</td>
                <td>{describeResult(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
