import { useEffect, useMemo, useState } from 'react';
import { SERIES_221, type CandidateSet } from '../../color/match';
import { BLANK_CODE, byCode } from '../../lib/sheetSort';
import { useEffectiveCatalog } from '../../state/useEffectiveCatalog';

const S221 = new Set<string>(SERIES_221);

/**
 * 选一个色号：从底部升起的一整块面板。
 *
 * 这一版换掉的是「行内输入框 + 小下拉」，三个毛病都是手机上暴露的：
 *
 *   - 点「改色号」，按钮**消失**、原地长出一个输入框。界面在手底下变形，用户还
 *     得重新找刚才点的地方。现在按钮一直在，面板盖在上面。
 *   - 一聚焦输入框，iOS 就把它滚进视野，**整页往上跳**，刚数好的豆点全跑没了。
 *     现在面板是 fixed 的，不参与页面滚动；搜索框也**不自动聚焦**——真要筛再点
 *     它，键盘弹起来也只顶面板自己。
 *   - 下拉是一列 14px 的小色块，手机上太小。现在是一片方格，一格 72px 起，
 *     色块占大半，扫一眼就能挑颜色而不是读色号。
 *
 * 候选口径和原来完全一样：**排除自定义色**（后端只认 BASE 色卡，选了会 422），
 * 按色卡范围过滤，按色号顺序排。色块用「我的色卡」里的有效色值——那是用户真正
 * 会摆上去的豆子颜色。
 */
export default function CodeSheet({
  title,
  onPick,
  onClose,
  scope = '291',
  allowBlank = false,
  value = '',
}: {
  title: string;
  onPick: (code: string) => void;
  onClose: () => void;
  scope?: CandidateSet;
  /** 有空格子的图纸：允许改成「空白格」，并且置顶 */
  allowBlank?: boolean;
  value?: string;
}) {
  const { colors } = useEffectiveCatalog();
  const [text, setText] = useState('');

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // 面板自己滚，别让底下那一长串豆点跟着滚——手机上尤其明显
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="code-sheet-layer">
      <button
        type="button"
        className="code-sheet-backdrop"
        aria-label="关闭"
        onClick={onClose}
      />
      <div className="code-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="code-sheet-head">
          <strong>{title}</strong>
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
        </header>

        <input
          className="code-sheet-search"
          role="combobox"
          aria-expanded
          aria-label="输入色号筛选"
          placeholder="输入色号筛选，如 H15"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 回车只在**唯一**候选时提交。多个候选时提交第一个等于替用户猜——
            // 这个功能整体的立场就是不猜。
            if (e.key === 'Enter' && matches.length === 1) onPick(matches[0]!.code);
          }}
        />

        <ul className="code-sheet-grid" role="listbox" aria-label={title}>
          {/* 置顶。它不是色号，是「这一格没有豆子」——有空格子的图纸上这是最常
              用的一项，埋在两百多个色号里面找不到。 */}
          {allowBlank && (
            <li>
              <button
                type="button"
                role="option"
                className="code-tile blank-option"
                aria-selected={value === BLANK_CODE}
                onClick={() => onPick(BLANK_CODE)}
              >
                <span className="swatch blank" />
                空白格
              </button>
            </li>
          )}
          {matches.map((c) => (
            <li key={c.code}>
              <button
                type="button"
                role="option"
                className="code-tile"
                aria-selected={c.code === value}
                onClick={() => onPick(c.code)}
              >
                <span className="swatch" style={{ background: `#${c.hex}` }} />
                {c.code}
              </button>
            </li>
          ))}
        </ul>
        {matches.length === 0 && !allowBlank && <p className="muted">没有匹配的色号</p>}
      </div>
    </div>
  );
}
