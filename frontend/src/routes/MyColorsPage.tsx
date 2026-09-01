import { Plus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { ApiError, apiSend } from '../api/client';
import { useUserColors } from '../api/hooks';
import AddColorDialog from '../components/AddColorDialog';
import ColorEditDialog from '../components/ColorEditDialog';
import { useToast } from '../state/ToastContext';
import { useEffectiveCatalog } from '../state/useEffectiveCatalog';

const SOURCE_LABEL: Record<string, string> = {
  base: '标准',
  override: '已改',
  custom: '自定义',
};

export default function MyColorsPage() {
  const { colors } = useEffectiveCatalog();
  const { data: userColors } = useUserColors();
  const { show } = useToast();
  const qc = useQueryClient();

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ code: string; hex: string } | null>(null);
  const [adding, setAdding] = useState(false);
  // Inline HEX editing, so changing a colour is one click in this table rather
  // than a round trip through a dialog.
  const [inlineCode, setInlineCode] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const baseHexOf = useMemo(
    () => new Map((userColors ?? []).map((c) => [c.code, c.base_hex])),
    [userColors],
  );

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q ? colors.filter((c) => c.code.startsWith(q)) : colors;
  }, [colors, query]);

  const saveHex = useMutation({
    mutationFn: (v: { code: string; hex: string }) =>
      apiSend<unknown>('PUT', `/api/colors/${encodeURIComponent(v.code)}`, { hex: v.hex }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['colors'] }),
  });

  function startInline(code: string, hex: string) {
    setInlineCode(code);
    setDraft(hex);
  }

  async function commitInline(code: string) {
    if (inlineCode !== code) return;
    setInlineCode(null);
    const next = draft.trim().replace(/^#/, '').toUpperCase();
    const current = colors.find((x) => x.code === code)?.hex.toUpperCase();
    if (next === current) return;
    if (!/^[0-9A-F]{6}$/.test(next)) {
      show('HEX 需为 6 位十六进制，如 3677D2');
      return;
    }
    try {
      await saveHex.mutateAsync({ code, hex: next });
      show(`已更新 ${code}`);
    } catch (err) {
      show(err instanceof ApiError ? err.detail : '保存失败');
    }
  }

  function onHexKeyDown(e: KeyboardEvent<HTMLInputElement>, code: string) {
    if (e.key === 'Enter') void commitInline(code);
    if (e.key === 'Escape') setInlineCode(null);
  }

  const remove = useMutation({
    mutationFn: (code: string) => apiSend<void>('DELETE', `/api/colors/${encodeURIComponent(code)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['colors'] }),
  });

  async function onRemove(code: string, revert: boolean) {
    try {
      await remove.mutateAsync(code);
      show(revert ? `${code} 已恢复默认` : `已删除 ${code}`);
    } catch (err) {
      show(err instanceof ApiError ? err.detail : '删除失败');
    }
  }

  function openEdit(code: string) {
    const c = colors.find((x) => x.code === code);
    setEditing({ code, hex: c?.hex ?? '7F7F7F' });
  }

  return (
    <section aria-label="我的色卡" className="colors-page">
      <div className="toolbar">
        <input
          type="search"
          aria-label="搜索色号"
          placeholder="搜索色号，如 A1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" onClick={() => setAdding(true)}>
          <Plus size={15} aria-hidden="true" />
          添加色号
        </button>
      </div>

      <table aria-label="我的色卡">
        <thead>
          <tr>
            <th>色号</th>
            <th>颜色</th>
            <th>HEX</th>
            <th>来源</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.code}>
              <td>{c.code}</td>
              <td>
                <span className="swatch" style={{ background: `#${c.hex}` }} />
              </td>
              <td>
                {inlineCode === c.code ? (
                  <input
                    autoFocus
                    aria-label={`${c.code} HEX`}
                    className="hex-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => onHexKeyDown(e, c.code)}
                    onBlur={() => void commitInline(c.code)}
                  />
                ) : (
                  <button
                    type="button"
                    className="hex-cell"
                    title={`点击直接修改 ${c.code} 的 HEX`}
                    onClick={() => startInline(c.code, c.hex)}
                  >
                    #{c.hex}
                  </button>
                )}
              </td>
              <td>
                <span className="source-tag">{SOURCE_LABEL[c.source] ?? c.source}</span>{' '}
                {c.source === 'override' && baseHexOf.get(c.code) && (
                  <span className="muted">默认 #{baseHexOf.get(c.code)}</span>
                )}
              </td>
              <td className="opactions">
                <button type="button" onClick={() => openEdit(c.code)}>
                  取色
                </button>
                {c.source === 'override' && (
                  <button type="button" onClick={() => void onRemove(c.code, true)}>
                    恢复默认
                  </button>
                )}
                {c.source === 'custom' && (
                  <button type="button" onClick={() => void onRemove(c.code, false)}>
                    删除
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <ColorEditDialog code={editing.code} hex={editing.hex} onClose={() => setEditing(null)} />
      )}
      {adding && <AddColorDialog onClose={() => setAdding(false)} onExisting={openEdit} />}
    </section>
  );
}
