import { useState } from 'react';
import { apiUpload } from '../../api/client';
import type { SheetGuess } from '../../api/types';
import { useToast } from '../../state/ToastContext';

/** 一次只收一张图：角点拖拽的界面天然是单图。 */
export default function SheetUpload({
  onUploaded,
}: {
  onUploaded: (g: SheetGuess) => void;
}) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      onUploaded(await apiUpload<SheetGuess>('/api/sheets', form));
    } catch (e) {
      show(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-upload">
      <label htmlFor="sheet-file">选择图纸</label>
      <input
        id="sheet-file"
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
        }}
      />
      <p className="muted">一次一张。支持生成器导出的规整图片；手机拍的照片暂不支持。</p>
    </div>
  );
}
