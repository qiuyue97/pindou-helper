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
  const [name, setName] = useState('');

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
    <section className="sheet-upload">
      {/* 标题、按钮、文件名、说明各占一行。原来是原生 file 控件直接摆着，
          「上传图纸 选择文件 未选择任何文件」连成一条，既看不出层次，手机上
          还会被挤断。原生控件的按钮和文件名是同一个 shadow DOM，拆不开——
          所以把它藏起来，自己画一个按钮和一行文件名。 */}
      <h3>上传图纸</h3>
      <input
        id="sheet-file"
        aria-label="上传图纸"
        className="offscreen"
        type="file"
        accept="image/*"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setName(f.name);
          void pick(f);
        }}
      />
      <label htmlFor="sheet-file" className={`file-button${busy ? ' is-busy' : ''}`}>
        {busy ? '上传中…' : '选择文件'}
      </label>
      <p className="muted file-name">{name || '未选择任何文件'}</p>
      <p className="muted">一次一张。支持生成器导出的规整图片；手机拍的照片暂不支持。</p>
    </section>
  );
}
