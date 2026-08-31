import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiSend } from '../api/client';
import type { ColorRow } from '../api/types';
import { useToast } from '../state/ToastContext';
import ColorPicker from './ColorPicker';
import Modal from './Modal';

export default function ColorEditDialog({
  code,
  hex,
  onClose,
}: {
  code: string;
  hex: string;
  onClose: () => void;
}) {
  const { show } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(hex);

  const save = useMutation({
    mutationFn: (next: string) =>
      apiSend<ColorRow>('PUT', `/api/colors/${encodeURIComponent(code)}`, { hex: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['colors'] }),
  });

  async function submit() {
    try {
      await save.mutateAsync(draft);
      show(`已更新 ${code}`);
      onClose();
    } catch (err) {
      show(err instanceof ApiError ? err.detail : '保存失败');
    }
  }

  return (
    <Modal
      title={`修改 ${code} 的颜色`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" onClick={() => void submit()}>
            保存
          </button>
        </>
      }
    >
      <ColorPicker hex={draft} onChange={setDraft} />
    </Modal>
  );
}
