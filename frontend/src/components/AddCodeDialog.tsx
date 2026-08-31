import { useState } from 'react';
import { apiSend } from '../api/client';
import { useApiMutation } from '../api/hooks';
import type { ChangesOut } from '../api/types';
import { formatChanges } from '../lib/qty';
import { useToast } from '../state/ToastContext';
import { useEffectiveCatalog } from '../state/useEffectiveCatalog';
import Modal from './Modal';

export default function AddCodeDialog({ onClose }: { onClose: () => void }) {
  const { colors, byCode } = useEffectiveCatalog();
  const { show } = useToast();
  const [code, setCode] = useState('');
  const [qty, setQty] = useState('0');
  const [error, setError] = useState('');

  const add = useApiMutation((v: { code: string; quantity: number }) =>
    apiSend<ChangesOut>('PUT', `/api/inventory/${encodeURIComponent(v.code)}`, {
      quantity: v.quantity,
    }),
  );

  async function submit() {
    const normalized = code.trim().toUpperCase();
    if (!byCode.has(normalized)) {
      setError(`色号 '${normalized}' 不存在`);
      return;
    }
    const quantity = Number(qty);
    if (qty.trim() === '' || !Number.isInteger(quantity)) {
      setError('数量应为整数');
      return;
    }
    const res = await add.mutateAsync({ code: normalized, quantity });
    show(formatChanges(res.changes));
    onClose();
  }

  return (
    <Modal
      title="添加色号"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" onClick={() => void submit()}>
            确定
          </button>
        </>
      }
    >
      <label htmlFor="add-code">色号</label>
      <input
        id="add-code"
        list="catalog-codes"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setError('');
        }}
      />
      <datalist id="catalog-codes">
        {colors.map((c) => (
          <option key={c.code} value={c.code} />
        ))}
      </datalist>

      <label htmlFor="add-qty">初始数量</label>
      <input
        id="add-qty"
        inputMode="numeric"
        value={qty}
        onChange={(e) => {
          setQty(e.target.value);
          setError('');
        }}
      />

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
