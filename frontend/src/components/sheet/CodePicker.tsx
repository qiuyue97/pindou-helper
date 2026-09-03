import { useMemo, useRef, useState } from 'react';
import { SERIES_221, type CandidateSet } from '../../color/match';
import { BLANK_CODE, byCode } from '../../lib/sheetSort';
import { useEffectiveCatalog } from '../../state/useEffectiveCatalog';

const S221 = new Set<string>(SERIES_221);

/**
 * 选一个色号：文字输入 + 自绘下拉，输入即过滤。
 *
 * 刻意不用原生 `<select>`。iOS 把 select 渲染成全屏滚轮，二百多个色号在那里面
 * 要滚很久而且看不到颜色。自绘的下拉能带色块，能按输入过滤，在桌面和触摸上
 * 表现一致。
 *
 * 下拉是**浮层**（absolute + z-index），不占文档流：它一度写成常驻的行内列表，
 * 结果二百多个候选把下面的卡片整个顶开、还盖住了旁边的内容。
 *
 * **自定义色排除在外**：后端只认 BASE 色卡，选了会 422。色块用「我的色卡」里的
 * 有效色值——那是用户真正会摆上去的豆子颜色。
 */
export default function CodePicker({
  value,
  onChange,
  scope = '291',
  autoFocus = false,
  label = '色号',
  allowBlank = false,
}: {
  value: string;
  onChange: (code: string) => void;
  scope?: CandidateSet;
  autoFocus?: boolean;
  label?: string;
  /** 有空格子的图纸：允许把格子改成「空白格」，并且置顶 */
  allowBlank?: boolean;
}) {
  const { colors } = useEffectiveCatalog();
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(autoFocus);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pool = useMemo(
    () =>
      colors
        .filter((c) => c.source !== 'custom')
        .filter((c) => scope === '291' || S221.has(c.series))
        .sort((a, b) => byCode(a.code, b.code)),
    [colors, scope],
  );

  const q = text.trim().toUpperCase();
  const matches = useMemo(
    () => (q ? pool.filter((c) => c.code.toUpperCase().startsWith(q)) : pool),
    [pool, q],
  );

  function commit(code: string) {
    setText(code);
    setOpen(false);
    onChange(code);
  }

  return (
    <div
      className="code-picker"
      onBlur={() => {
        // 延一拍再收：blur 先于候选项的 click 触发，立刻收起来就点不中了
        closing.current = setTimeout(() => setOpen(false), 120);
      }}
      onFocus={() => {
        if (closing.current) clearTimeout(closing.current);
        setOpen(true);
      }}
    >
      <input
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        value={text}
        autoFocus={autoFocus}
        placeholder="输入色号"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          // 回车只在**唯一**候选时提交。多个候选时提交第一个等于替用户猜——
          // 这个功能整体的立场就是不猜。
          if (e.key === 'Enter' && matches.length === 1) commit(matches[0]!.code);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul role="listbox" className="code-picker-list">
          {/* 置顶。它不是色号，是「这一格没有豆子」——有空格子的图纸上这是最常
              用的一项，埋在两百多个色号里面找不到。 */}
          {allowBlank && (
            <li>
              <button
                type="button"
                role="option"
                className="blank-option"
                aria-selected={value === BLANK_CODE}
                onClick={() => commit(BLANK_CODE)}
              >
                <span className="swatch blank" />
                空白格
              </button>
            </li>
          )}
          {matches.length === 0 && !allowBlank && <li className="muted">没有匹配的色号</li>}
          {matches.map((c) => (
            <li key={c.code}>
              <button
                type="button"
                role="option"
                aria-selected={c.code === value}
                onClick={() => commit(c.code)}
              >
                <span className="swatch" style={{ background: `#${c.hex}` }} />
                {c.code}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
