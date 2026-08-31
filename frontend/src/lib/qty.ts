import type { Change } from '../api/types';

export type QtyTier = 'negative' | 'low' | 'ok';

export function qtyTier(quantity: number, threshold: number): QtyTier {
  if (quantity < 0) return 'negative';
  if (quantity < threshold) return 'low';
  return 'ok';
}

const n = (v: number | null) => (v === null ? '—' : String(v));

export function formatChanges(changes: Change[]): string {
  if (changes.length === 0) return '库存无变化';
  const body = changes.map((c) => `${c.code} ${n(c.from)}→${n(c.to)}`).join('，');
  return changes.length > 1 ? `${body}（${changes.length} 个色号受影响）` : body;
}
