/**
 * 对账表：上层操作的唯一入口。
 *
 * 按**色号**列行，不是按颜色类。一个色号名下有多个类是常态——聚类的切口故意很紧，
 * 裂开是设计出来的预期结果，两个类独立读出同一个色号是一致的证据。合并、求和。
 *
 * 改这一行的色号要把名下**每一个** k 都带上。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Sheet, SheetClass } from '../../api/types';
import ReconcileTable from './ReconcileTable';

vi.mock('../../state/useEffectiveCatalog', () => ({
  useEffectiveCatalog: () => ({
    colors: [
      { code: 'H15', series: 'H', hex: '00FF00', source: 'base' },
      { code: 'B8', series: 'B', hex: '0000FF', source: 'base' },
    ],
    byCode: new Map(),
    isLoading: false,
  }),
}));

function cls(p: Partial<SheetClass> & { klass: number; code: string }): SheetClass {
  return {
    source: 'ocr',
    level: 'ok',
    de: 0.5,
    n: 10,
    radius: 1,
    rgb: [0, 255, 0],
    nearest: p.code,
    nearest_de: 0.5,
    read_full: p.code,
    off_list: false,
    dup: null,
    cells: [],
    ...p,
  };
}

const SHEET = {
  id: 1,
  rows: 4,
  cols: 5,
  palette: '221',
  classes: [cls({ klass: 0, code: 'H15', n: 20 }), cls({ klass: 1, code: 'H15', n: 14 })],
  counts: [{ code: 'H15', sheet: 34, prior: 34, classes: [0, 1], level: 'ok' }],
  prior: { H15: 34 },
  overrides: {},
  tally: { H15: 34 },
} as unknown as Sheet;

function setup(sheet: Sheet = SHEET) {
  const onPatchClasses = vi.fn();
  const onPatchPrior = vi.fn();
  render(
    <ReconcileTable sheet={sheet} onPatchClasses={onPatchClasses} onPatchPrior={onPatchPrior} />,
  );
  return { onPatchClasses, onPatchPrior };
}

it('同一色号的多个类合并成一行，数量求和', () => {
  setup();
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows).toHaveLength(1);
  expect(within(rows[0]!).getByText('34')).toBeInTheDocument();
});

it('改一行的色号会把名下所有类都带上', () => {
  const { onPatchClasses } = setup();
  fireEvent.click(screen.getByRole('button', { name: /改色号/ }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'B8' } });
  fireEvent.click(screen.getByRole('option', { name: 'B8' }));
  expect(onPatchClasses).toHaveBeenCalledWith([
    { k: 0, code: 'B8' },
    { k: 1, code: 'B8' },
  ]);
});

it('改 AI 数量打到 prior，不是打到本图数量', () => {
  const { onPatchPrior } = setup();
  const input = screen.getByLabelText('H15 的 AI 数量');
  fireEvent.change(input, { target: { value: '40' } });
  fireEvent.blur(input);
  expect(onPatchPrior).toHaveBeenCalledWith({ H15: 40 });
});

it('本图数量不可编辑——它是数出来的事实', () => {
  setup();
  expect(screen.queryByLabelText('H15 的本图数量')).toBeNull();
});

it('先验里有但没有任何类对应的色号也占一行，且改不了色号', () => {
  const s = {
    ...SHEET,
    counts: [
      ...SHEET.counts,
      { code: 'B8', sheet: 0, prior: 3, classes: [], level: 'count' },
    ],
  } as unknown as Sheet;
  setup(s);
  const row = screen.getByRole('row', { name: /B8/ });
  expect(within(row).getByText('0')).toBeInTheDocument();
  expect(row.className).toContain('level-count');
  expect(screen.getByRole('button', { name: '改色号 B8' })).toBeDisabled();
});

it('名下类心色差得远时给出提示', () => {
  const s = {
    ...SHEET,
    classes: [
      cls({ klass: 0, code: 'H15', dup: 9.4 }),
      cls({ klass: 1, code: 'H15', dup: 9.4 }),
    ],
  } as unknown as Sheet;
  setup(s);
  expect(screen.getByTitle(/颜色相差/)).toBeInTheDocument();
});

it('名下有多个类时并排显示它们的色块', () => {
  const { container } = render(
    <ReconcileTable sheet={SHEET} onPatchClasses={() => {}} onPatchPrior={() => {}} />,
  );
  expect(container.querySelectorAll('tbody .swatch')).toHaveLength(2);
});

it('删掉一行先验就是把它的数量置空', () => {
  const { onPatchPrior } = setup();
  fireEvent.click(screen.getByRole('button', { name: /删除 H15 的基准/ }));
  expect(onPatchPrior).toHaveBeenCalledWith({});
});

it('行按后端给的顺序渲染——后端已经按色号排好了', () => {
  const s = {
    ...SHEET,
    counts: [
      { code: 'A2', sheet: 1, prior: null, classes: [], level: 'count' },
      { code: 'A10', sheet: 2, prior: null, classes: [], level: 'count' },
    ],
  } as unknown as Sheet;
  setup(s);
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['A2', 'A10']);
});
