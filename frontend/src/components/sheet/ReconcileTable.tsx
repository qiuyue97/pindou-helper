import { useState } from 'react';
import type { Sheet, SheetLevel } from '../../api/types';
import { LEVEL_WHY, groupByCode } from '../../lib/sheetSort';
import CodePicker from './CodePicker';

const LABEL: Record<SheetLevel, string> = {
  ok: '正常',
  warn: '颜色存疑',
  count: '与图例数量不符',
  guess: '未读出，按颜色猜的',
};

/**
 * 对账表：把「本图数出来的」和「AI 从图例读到的」摆在一起。
 *
 * 按**色号**列行，不是按颜色类。一个色号名下有多个类是常态（聚类的切口故意很紧，
 * 裂开是预期结果），两个类**独立**读出同一个色号是一致的证据——相信 OCR，合并求和。
 *
 * 上层的两种操作都在这里：
 *   改色号  -> classes[k].code，一次改掉名下所有类的全部格子
 *   改数量  -> prior[code]，改的是 AI 的说法，不是本图的事实
 *
 * 本图数量不给改：它是数出来的。要让它变，只能去下面的格子区改格子。
 */
export default function ReconcileTable({
  sheet,
  onPatchClasses,
  onPatchPrior,
}: {
  sheet: Sheet;
  onPatchClasses: (patches: Array<{ k: number; code: string }>) => void;
  onPatchPrior: (prior: Record<string, number>) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const groups = new Map(groupByCode(sheet.classes).map((g) => [g.code, g]));

  function setPrior(code: string, n: number | null) {
    const next = { ...sheet.prior };
    if (n && n > 0) next[code] = n;
    else delete next[code];
    onPatchPrior(next);
  }

  return (
    <table className="preview reconcile-table" aria-label="色号对账">
      <thead>
        <tr>
          <th>颜色</th>
          <th>色号</th>
          <th>本图数量</th>
          <th>AI 数量</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {sheet.counts.map((row) => {
          const g = groups.get(row.code);
          return (
            <tr key={row.code} className={`level-${row.level}`} aria-label={row.code}>
              <td>
                {/* 名下有几个类就并排几个色块——它们的颜色本来就略有不同 */}
                {g?.classes.map((c) => (
                  <span
                    key={c.klass}
                    className="swatch"
                    style={{ background: `rgb(${c.rgb.join(',')})` }}
                  />
                ))}
                {g?.spread != null && (
                  <span
                    className="why"
                    title={`名下几个类的颜色相差 ${g.spread} dE00，它们不可能是同一个色号——去下面的格子区看看`}
                  >
                    ⚠
                  </span>
                )}
              </td>
              <td>
                {editing === row.code ? (
                  <CodePicker
                    value={row.code}
                    scope={sheet.palette}
                    autoFocus
                    label={`${row.code} 的新色号`}
                    onChange={(code) => {
                      setEditing(null);
                      // 名下每一个类都要带上，否则只改了一半的格子
                      onPatchClasses(row.classes.map((k) => ({ k, code })));
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="linklike"
                    aria-label={`改色号 ${row.code}`}
                    disabled={row.classes.length === 0}
                    onClick={() => setEditing(row.code)}
                  >
                    {row.code}
                  </button>
                )}
              </td>
              {/* 本图数量是事实，不给改 */}
              <td>{row.sheet}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  aria-label={`${row.code} 的 AI 数量`}
                  defaultValue={row.prior ?? ''}
                  onBlur={(e) => setPrior(row.code, Number(e.target.value) || null)}
                />
                <button
                  type="button"
                  className="ghost"
                  aria-label={`删除 ${row.code} 的基准`}
                  onClick={() => setPrior(row.code, null)}
                >
                  ×
                </button>
              </td>
              <td title={LEVEL_WHY[row.level]}>{LABEL[row.level]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
