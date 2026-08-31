import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiSend } from '../api/client';
import type { ColorRow } from '../api/types';
import { useToast } from '../state/ToastContext';
import ColorPicker from './ColorPicker';
import Modal from './Modal';

const CODE_RE = /^[A-Z0-9_-]{1,12}$/;

export default function AddColorDialog({
  onClose,
  onExisting,
}: {
  onClose: () => void;
  onExisting: (code: string) => void;
}) {
  const { show } = useToast();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [hex, setHex] = useState('7F7F7F');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (body: { code: string; hex: string }) =>
      apiSend<ColorRow>('POST', '/api/colors', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['colors'] }),
  });

  async function submit() {
    const normalized = code.trim().toUpperCase();
    if (!CODE_RE.test(normalized)) {
      setError('色号应为 1-12 位字母、数字、_ 或 -');
      return;
    }
    setError('');
    setConflict(null);
    try {
      await add.mutateAsync({ code: normalized, hex });
      show(`已添加 ${normalized}`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(normalized);
        return;
      }
      show(err instanceof ApiError ? err.detail : '添加失败');
    }
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
      <label htmlFor="new-code">色号</label>
      <input
        id="new-code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setError('');
          setConflict(null);
        }}
      />

      <ColorPicker hex={hex} onChange={setHex} />

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      {conflict && (
        <p role="alert" className="error">
          该色号已存在，是否改为修改它的 HEX?{' '}
          <button
            type="button"
            className="linklike"
            onClick={() => {
              onClose();
              onExisting(conflict);
            }}
          >
            改为修改
          </button>
        </p>
      )}
    </Modal>
  );
}
