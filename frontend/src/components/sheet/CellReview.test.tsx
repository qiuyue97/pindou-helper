/**
 * 按色号分组的格子校对。
 *
 * 这里**只做单格和多选**。改整类不在格子的操作空间里——那是上面对账表的事。
 *
 * 一万格不进 DOM：默认每个色号一张卡，展开某组才画那一组的格子，而且画在
 * canvas 上；可点击层按页封顶，节点数不随色号的格子数增长。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Sheet, SheetClass } from '../../api/types';
import { stubCanvas2D } from '../../test/setup';
import CellReview from './CellReview';

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
    n: 2,
    radius: 1,
    rgb: [0, 255, 0],
    nearest: p.code,
    nearest_de: 0.5,
    read_full: p.code,
    off_list: false,
    dup: null,
    cells: [0, 1],
    ...p,
  };
}

const SHEET = {
  id: 1,
  rows: 2,
  cols: 2,
  rect: [0, 0, 20, 20],
  palette: '221',
  labels: [0, 0, 1, 1],
  classes: [
    cls({ klass: 0, code: 'H15', cells: [0, 1] }),
    cls({ klass: 1, code: 'B8', level: 'guess', cells: [2, 3] }),
  ],
  counts: [],
  prior: {},
  overrides: {},
  tally: {},
} as unknown as Sheet;

beforeEach(() => {
  stubCanvas2D();
});

function setup(sheet: Sheet = SHEET) {
  const onPatchCells = vi.fn();
  render(<CellReview sheet={sheet} onPatchCells={onPatchCells} />);
  return onPatchCells;
}

it('每个色号一张卡，警告优先', () => {
  setup();
  const cards = screen.getAllByRole('button', { name: /展开/ });
  expect(cards[0]).toHaveAccessibleName(/B8/); // guess 排最前
});

it('默认不画任何格子——一万格不能一上来就全渲染', () => {
  const { container } = render(<CellReview sheet={SHEET} onPatchCells={() => {}} />);
  expect(container.querySelectorAll('canvas.cell-grid')).toHaveLength(0);
});

it('展开某组才画那一组的格子', () => {
  const { container } = render(<CellReview sheet={SHEET} onPatchCells={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /展开 H15/ }));
  expect(container.querySelectorAll('canvas.cell-grid')).toHaveLength(1);
});

it('一次只展开一组', () => {
  const { container } = render(<CellReview sheet={SHEET} onPatchCells={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /展开 H15/ }));
  fireEvent.click(screen.getByRole('button', { name: /展开 B8/ }));
  expect(container.querySelectorAll('canvas.cell-grid')).toHaveLength(1);
});

it('选一格再改色号，只改那一格', () => {
  const onPatchCells = setup();
  fireEvent.click(screen.getByRole('button', { name: /展开 H15/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: '第 1 行第 1 列' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'B8' } });
  fireEvent.click(screen.getByRole('option', { name: 'B8' }));
  expect(onPatchCells).toHaveBeenCalledWith([{ r: 0, c: 0, code: 'B8' }]);
});

it('多选一次改掉几格', () => {
  const onPatchCells = setup();
  fireEvent.click(screen.getByRole('button', { name: /展开 H15/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: '第 1 行第 1 列' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '第 1 行第 2 列' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'B8' } });
  fireEvent.click(screen.getByRole('option', { name: 'B8' }));
  expect(onPatchCells).toHaveBeenCalledWith([
    { r: 0, c: 0, code: 'B8' },
    { r: 0, c: 1, code: 'B8' },
  ]);
});

it('没选格子时改不了', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /展开 H15/ }));
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText(/选中格子后可以改/)).toBeInTheDocument();
});

it('没有「把整类都改掉」这种按钮——那是上面对账表的事', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /展开 H15/ }));
  expect(screen.queryByRole('button', { name: /整类|全部改/ })).toBeNull();
});

it('人工改过的格子标出来，并且能撤销', () => {
  const onPatchCells = setup({ ...SHEET, overrides: { '0,0': 'B8' } } as unknown as Sheet);
  fireEvent.click(screen.getByRole('button', { name: /展开 H15/ }));
  fireEvent.click(screen.getByRole('button', { name: /撤销第 1 行第 1 列/ }));
  expect(onPatchCells).toHaveBeenCalledWith([{ r: 0, c: 0, code: '' }]);
});

it('卡片上写清楚这一组为什么被标记', () => {
  setup();
  expect(screen.getByText(/未读出色号/)).toBeInTheDocument();
});

it('格子很多时可点击层按页封顶，不随格子数增长', () => {
  const many = Array.from({ length: 2961 }, (_, i) => i);
  const big = {
    ...SHEET,
    rows: 60,
    cols: 60,
    classes: [cls({ klass: 0, code: 'H15', n: many.length, cells: many })],
  } as unknown as Sheet;
  const { container } = render(<CellReview sheet={big} onPatchCells={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /展开 H15/ }));
  // 2961 格分页展示，DOM 里的 checkbox 数量有上界
  expect(container.querySelectorAll('.cell-hit').length).toBeLessThanOrEqual(120);
  expect(screen.getByText(/共 2961 格/)).toBeInTheDocument();
});

it('翻页换一批格子', () => {
  const many = Array.from({ length: 300 }, (_, i) => i);
  const big = {
    ...SHEET,
    rows: 20,
    cols: 20,
    classes: [cls({ klass: 0, code: 'H15', n: 300, cells: many })],
  } as unknown as Sheet;
  render(<CellReview sheet={big} onPatchCells={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /展开 H15/ }));
  expect(screen.getByRole('checkbox', { name: '第 1 行第 1 列' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.queryByRole('checkbox', { name: '第 1 行第 1 列' })).toBeNull();
  expect(screen.getByText(/第 2 \/ 3 页/)).toBeInTheDocument();
});

it('格子少时不显示翻页', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /展开 H15/ }));
  expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
});
