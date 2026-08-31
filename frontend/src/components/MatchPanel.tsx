import { lazy, Suspense, useMemo } from 'react';
import type { EffectiveColor } from '../color/catalog';
import { useInventory } from '../api/hooks';
import { hexToLab } from '../color/color';
import { buildIndex, rankMatches, verdict, type CandidateSet } from '../color/match';

// Dev-only comparison metrics. The lazy() boundary keeps the chunk out of the
// default build's entry bundle; deleting this file plus the guard below is safe.
const SHOW_ADVANCED = import.meta.env.VITE_SHOW_ADVANCED_METRICS === '1';
const Advanced = lazy(() => import('./AdvancedMetricsPanel'));

export default function MatchPanel({
  hex,
  candidates,
  set,
  includeCustom,
  onSetChange,
  onIncludeCustomChange,
}: {
  hex: string | null;
  candidates: EffectiveColor[];
  set: CandidateSet;
  includeCustom: boolean;
  onSetChange: (set: CandidateSet) => void;
  onIncludeCustomChange: (include: boolean) => void;
}) {
  const { data: inventory } = useInventory();

  // O(n^2) — keyed on candidates only, never on the sample.
  const index = useMemo(() => buildIndex(candidates), [candidates]);
  const ranked = useMemo(
    () => (hex && candidates.length >= 2 ? rankMatches(hexToLab(hex), candidates, index) : null),
    [hex, candidates, index],
  );

  const stock = useMemo(
    () => new Map((inventory ?? []).map((r) => [r.code, r.quantity])),
    [inventory],
  );

  return (
    <div className="match">
      <fieldset className="match-controls">
        <legend className="offscreen">候选集</legend>
        <div role="radiogroup" aria-label="候选集">
          {(['221', '291'] as const).map((s) => (
            <label key={s}>
              <input
                type="radio"
                name="candidate-set"
                checked={set === s}
                onChange={() => onSetChange(s)}
                aria-label={s === '221' ? '221（A–M）' : '291（全部）'}
              />
              {s === '221' ? '221（A–M）' : '291（全部）'}
            </label>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={includeCustom}
            onChange={(e) => onIncludeCustomChange(e.target.checked)}
          />
          包含我的自定义色
        </label>
      </fieldset>

      {!hex ? (
        <p className="muted">先取一个颜色：屏幕吸色、上传图片后滑过取色，或直接填十六进制。</p>
      ) : !ranked ? (
        <p>还需要至少两个候选色</p>
      ) : (
        <>
          <div className="headline" data-testid="match-headline">
            <span className="headline-swatch" style={{ background: `#${ranked.best.color.hex}` }} />
            <div>
              <strong className="headline-code">{ranked.best.color.code}</strong>
              <p className="headline-verdict">{verdict(ranked).text}</p>
            </div>
          </div>

          {ranked.ambiguousWith && (
            <div className="headline alt">
              <span
                className="headline-swatch"
                style={{ background: `#${ranked.ambiguousWith.hex}` }}
              />
              <div>
                <span className="muted">备选</span> <strong>{ranked.ambiguousWith.code}</strong>
              </div>
            </div>
          )}

          <details>
            <summary>更多候选</summary>
            <table aria-label="候选色号" className="preview">
              <thead>
                <tr>
                  <th>色号</th>
                  <th>颜色</th>
                  <th>ΔE00</th>
                  <th>库存</th>
                </tr>
              </thead>
              <tbody>
                {ranked.list.slice(0, 5).map((row) => (
                  <tr key={row.color.code}>
                    <td>{row.color.code}</td>
                    <td>
                      <span className="swatch" style={{ background: `#${row.color.hex}` }} />
                    </td>
                    <td>{row.dE00.toFixed(1)}</td>
                    <td>
                      {stock.has(row.color.code) ? `库存 ${stock.get(row.color.code)}` : '未入库'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          {SHOW_ADVANCED && (
            <Suspense fallback={null}>
              <Advanced sampleHex={hex} candidates={candidates} />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
