import { useMemo, useState, type KeyboardEvent } from 'react';
import { apiSend } from '../api/client';
import { useApiMutation, useInventory } from '../api/hooks';
import type { ChangesOut } from '../api/types';
import type { EffectiveColor } from '../color/catalog';
import { SERIES_221, type CandidateSet } from '../color/match';
import { swatchTextColor } from '../lib/contrast';
import { formatChanges, qtyTier } from '../lib/qty';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';
import { useEffectiveCatalog } from '../state/useEffectiveCatalog';

const S221 = new Set<string>(SERIES_221);

interface Section {
  label: string;
  series: [string, EffectiveColor[]][];
}

/** Group the catalogue into ordered series columns, split into at most two sections. */
function buildSections(colors: EffectiveColor[], scopeSet: CandidateSet): Section[] {
  const groups = new Map<string, EffectiveColor[]>();
  for (const c of colors) {
    if (scopeSet === '221' && c.source !== 'custom' && !S221.has(c.series)) continue;
    const bucket = groups.get(c.series);
    if (bucket) bucket.push(c);
    else groups.set(c.series, [c]);
  }

  const standard: [string, EffectiveColor[]][] = [];
  const special: [string, EffectiveColor[]][] = [];
  for (const [series, list] of groups) {
    (S221.has(series) ? standard : special).push([series, list]);
  }

  const sections: Section[] = [];
  if (standard.length) sections.push({ label: '标准色 A–M', series: standard });
  if (special.length) sections.push({ label: '特殊色', series: special });
  // With only one section there is nothing to distinguish, so drop the heading.
  return sections.length === 1 ? [{ ...sections[0]!, label: '' }] : sections;
}

export default function InventoryTable({ scopeSet }: { scopeSet: CandidateSet }) {
  const { me } = useAuth();
  const { show } = useToast();
  const { colors } = useEffectiveCatalog();
  const { data: rows, isLoading } = useInventory();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const threshold = me?.threshold ?? 0;
  const quantities = useMemo(
    () => new Map((rows ?? []).map((r) => [r.code, r.quantity])),
    [rows],
  );
  const sections = useMemo(() => buildSections(colors, scopeSet), [colors, scopeSet]);

  const setQty = useApiMutation((v: { code: string; quantity: number }) =>
    apiSend<ChangesOut>('PUT', `/api/inventory/${encodeURIComponent(v.code)}`, {
      quantity: v.quantity,
    }),
  );

  function startEdit(code: string, quantity: number) {
    setEditing(code);
    setDraft(String(quantity));
  }

  async function commit(code: string) {
    if (editing !== code) return;
    const value = Number(draft);
    setEditing(null);
    if (draft.trim() === '' || !Number.isInteger(value)) {
      show('数量应为整数');
      return;
    }
    if (value === (quantities.get(code) ?? 0)) return;
    const res = await setQty.mutateAsync({ code, quantity: value });
    show(formatChanges(res.changes));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, code: string) {
    if (e.key === 'Enter') void commit(code);
    if (e.key === 'Escape') setEditing(null);
  }

  if (isLoading) return <p>加载中…</p>;

  return (
    <div className="inv">
      {sections.map((section) => (
        <section
          key={section.label || 'only'}
          className="inv-section"
          {...(section.label ? { 'aria-label': section.label } : {})}
        >
          {section.label && <h3 className="inv-section-title">{section.label}</h3>}
          <div className="inv-grid">
            {section.series.map(([series, list]) => (
              <div key={series} role="group" data-series={series} className="inv-col">
                <div className="inv-col-head">{series}</div>
                {list.map((c) => {
                  const qty = quantities.get(c.code) ?? 0;
                  const tier = qtyTier(qty, threshold);
                  return (
                    <div key={c.code} className="inv-cell" data-testid={`cell-${c.code}`}>
                      <span
                        className={`inv-block text-${swatchTextColor(c.hex)}`}
                        data-testid={`block-${c.code}`}
                        style={{ background: `#${c.hex}` }}
                        title={`${c.code} #${c.hex}`}
                      >
                        {c.code}
                      </span>
                      {editing === c.code ? (
                        <input
                          autoFocus
                          aria-label={`${c.code} 数量`}
                          className="inv-qty-input"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, c.code)}
                          onBlur={() => void commit(c.code)}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`inv-qty qty-${tier}`}
                          data-tier={tier}
                          onClick={() => startEdit(c.code, qty)}
                        >
                          {qty}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
