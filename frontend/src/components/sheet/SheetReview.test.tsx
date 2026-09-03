/**
 * 图纸校对：左边一条色号栏，右边这个色号下的豆点。
 *
 * 左右改的是**不同的东西**：
 *   左边改色号 -> 名下所有豆点跟着改
 *   左边改数量 -> 只改「图纸说有多少」，不动任何豆点
 *   右边改豆点 -> 那几个移出当前色号，进入目标色号
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CountRow, Sheet, SheetClass } from '../../api/types';
import { stubCanvas2D } from '../../test/setup';
import SheetReview from './SheetReview';

vi.mock('../../state/useEffectiveCatalog', () => ({
  useEffectiveCatalog: () => ({
    colors: [
      { code: 'H15', series: 'H', hex: '00FF00', source: 'base' },
      { code: 'B8', series: 'B', hex: '0000FF', source: 'base' },
      { code: 'M3', series: 'M', hex: 'FF00FF', source: 'base' },
    ],
    byCode: new Map(),
    isLoading: false,
  }),
}));

function cls(p: Partial<SheetClass> & { klass: number; code: string }): SheetClass {
  return {
    source: 'ocr', level: 'ok', de: 0.5, n: 2, radius: 1, rgb: [0, 255, 0],
    nearest: p.code, nearest_de: 0.5, read_full: p.code, off_list: false,
    dup: null, cells: [], ...p,
  };
}

function row(p: Partial<CountRow> & { code: string }): CountRow {
  return { sheet: 2, prior: 2, classes: [], level: 'ok', custom: false, ...p };
}

function makeSheet(over: Partial<Sheet> = {}): Sheet {
  return {
    id: 1, rows: 4, cols: 4, rect: [0, 0, 40, 40], palette: '221',
    labels: [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
    classes: [
      cls({ klass: 0, code: 'H15', n: 8, cells: [0, 1, 4, 5, 8, 9, 12, 13] }),
      cls({ klass: 1, code: 'B8', n: 8, cells: [2, 3, 6, 7, 10, 11, 14, 15] }),
    ],
    counts: [
      row({ code: 'H15', sheet: 8, prior: 8, classes: [0] }),
      row({ code: 'B8', sheet: 8, prior: 8, classes: [1] }),
    ],
    overrides: {},
    prior: { H15: 8, B8: 8 },
    ...over,
  } as unknown as Sheet;
}

function setup(sheet: Sheet = makeSheet()) {
  const onPatchClasses = vi.fn();
  const onPatchPrior = vi.fn();
  const onPatchCells = vi.fn();
  render(
    <SheetReview
      sheet={sheet}
      onPatchClasses={onPatchClasses}
      onPatchPrior={onPatchPrior}
      onPatchCells={onPatchCells}
    />,
  );
  return { onPatchClasses, onPatchPrior, onPatchCells };
}

beforeEach(() => {
  stubCanvas2D();
});

// ---------- 左栏 ----------

it('左栏列出每个色号', () => {
  setup();
  const list = screen.getByLabelText('色号列表');
  expect(within(list).getByText('H15')).toBeInTheDocument();
  expect(within(list).getByText('B8')).toBeInTheDocument();
});

it('两个数量用的是新说法', () => {
  setup();
  expect(screen.getAllByText('图纸数量').length).toBeGreaterThan(0);
  expect(screen.getAllByText('已识别数量').length).toBeGreaterThan(0);
  // 旧说法不该再出现
  expect(screen.queryByText('本图数量')).toBeNull();
  expect(screen.queryByText('AI 数量')).toBeNull();
});

it('已识别数量不可编辑——数出来的事实', () => {
  setup();
  expect(screen.queryByLabelText('H15 的已识别数量')).toBeNull();
  expect(screen.getByLabelText('H15 的图纸数量')).toBeInTheDocument();
});

it('改色号会把名下所有类都带上', () => {
  const s = makeSheet({
    classes: [
      cls({ klass: 0, code: 'H15', cells: [0, 1] }),
      cls({ klass: 2, code: 'H15', cells: [4, 5] }),
    ],
    counts: [row({ code: 'H15', sheet: 4, prior: 4, classes: [0, 2] })],
  });
  const { onPatchClasses } = setup(s);
  fireEvent.click(screen.getByRole('button', { name: '改色号 H15' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'B8' } });
  fireEvent.click(screen.getByRole('option', { name: 'B8' }));
  expect(onPatchClasses).toHaveBeenCalledWith([
    { k: 0, code: 'B8' },
    { k: 2, code: 'B8' },
  ]);
});

it('改图纸数量只动先验，不发豆点的改动', () => {
  const { onPatchPrior, onPatchCells } = setup();
  const input = screen.getByLabelText('H15 的图纸数量');
  fireEvent.change(input, { target: { value: '10' } });
  fireEvent.blur(input);
  expect(onPatchPrior).toHaveBeenCalledWith({ H15: 10, B8: 8 });
  expect(onPatchCells).not.toHaveBeenCalled();
});

it('数量对不上的着重标记，带感叹号', () => {
  const s = makeSheet({
    counts: [
      row({ code: 'H15', sheet: 8, prior: 11, classes: [0], level: 'count' }),
      row({ code: 'B8', sheet: 8, prior: 8, classes: [1] }),
    ],
  });
  const { container } = render(
    <SheetReview sheet={s} onPatchClasses={vi.fn()} onPatchPrior={vi.fn()} onPatchCells={vi.fn()} />,
  );
  const flag = container.querySelector('.flag.mismatch');
  expect(flag).toHaveTextContent('!');
  expect(flag!.getAttribute('title')).toContain('图纸说有 11 个');
});

it('用户自建的色号只给绿色标识，不算告警', () => {
  const s = makeSheet({
    counts: [
      row({ code: 'H15', sheet: 8, prior: 8, classes: [0] }),
      row({ code: 'M3', sheet: 1, prior: null, classes: [], custom: true }),
    ],
  });
  const { container } = render(
    <SheetReview sheet={s} onPatchClasses={vi.fn()} onPatchPrior={vi.fn()} onPatchCells={vi.fn()} />,
  );
  expect(container.querySelector('.flag.custom')).toBeInTheDocument();
  expect(container.querySelector('.flag.mismatch')).toBeNull();
});

it('没有先验时不显示图纸数量，也不谈对不上', () => {
  const s = makeSheet({
    prior: {},
    counts: [row({ code: 'H15', sheet: 8, prior: null, classes: [0] })],
  });
  setup(s);
  expect(screen.queryByText('图纸数量')).toBeNull();
  expect(screen.getByText('已识别数量')).toBeInTheDocument();
});

it('没有任何类的色号改不了色号——它只是图例上的一条', () => {
  const s = makeSheet({
    counts: [row({ code: 'H15', sheet: 0, prior: 3, classes: [], level: 'count' })],
  });
  setup(s);
  expect(screen.getByRole('button', { name: '改色号 H15' })).toBeDisabled();
});

// ---------- 右侧 ----------

it('默认展开第一个色号', () => {
  setup();
  expect(screen.getByText('共 8 个豆点')).toBeInTheDocument();
});

it('点左栏切换右侧', () => {
  setup(
    makeSheet({
      counts: [
        row({ code: 'H15', sheet: 8, prior: 8, classes: [0] }),
        row({ code: 'B8', sheet: 3, prior: 3, classes: [1] }),
      ],
      classes: [
        cls({ klass: 0, code: 'H15', n: 8, cells: [0, 1, 4, 5, 8, 9, 12, 13] }),
        cls({ klass: 1, code: 'B8', n: 3, cells: [2, 3, 6] }),
      ],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '查看 B8' }));
  expect(screen.getByText('共 3 个豆点')).toBeInTheDocument();
});

it('选中豆点改色号，只改选中的那几个', () => {
  const { onPatchCells } = setup();
  fireEvent.click(screen.getByRole('checkbox', { name: '第 1 行第 1 列' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'M3' } });
  fireEvent.click(screen.getByRole('option', { name: 'M3' }));
  expect(onPatchCells).toHaveBeenCalledWith([{ r: 0, c: 0, code: 'M3' }]);
});

it('多选一次改掉几个', () => {
  const { onPatchCells } = setup();
  fireEvent.click(screen.getByRole('checkbox', { name: '第 1 行第 1 列' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '第 1 行第 2 列' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'M3' } });
  fireEvent.click(screen.getByRole('option', { name: 'M3' }));
  expect(onPatchCells).toHaveBeenCalledWith([
    { r: 0, c: 0, code: 'M3' },
    { r: 0, c: 1, code: 'M3' },
  ]);
});

it('改去别的色号的豆点不再出现在原色号下', () => {
  // 0 号格本属 H15，被改成了 M3
  setup(makeSheet({ overrides: { '0,0': 'M3' } }));
  expect(screen.getByText('共 7 个豆点')).toBeInTheDocument();
});

it('改进来的豆点出现在目标色号下', () => {
  const s = makeSheet({
    overrides: { '0,0': 'M3' },
    counts: [
      row({ code: 'H15', sheet: 7, prior: 8, classes: [0], level: 'count' }),
      row({ code: 'M3', sheet: 1, prior: null, classes: [], custom: true }),
    ],
  });
  setup(s);
  fireEvent.click(screen.getByRole('button', { name: '查看 M3' }));
  expect(screen.getByText('共 1 个豆点')).toBeInTheDocument();
});

it('人工改过的豆点标出来并能撤销', () => {
  const { onPatchCells } = setup(makeSheet({ overrides: { '0,1': 'H15' } }));
  fireEvent.click(screen.getByRole('button', { name: /撤销第 1 行第 2 列/ }));
  expect(onPatchCells).toHaveBeenCalledWith([{ r: 0, c: 1, code: '' }]);
});

it('一页 50 个，多了分页', () => {
  const many = Array.from({ length: 120 }, (_, i) => i);
  const s = makeSheet({
    rows: 12, cols: 12,
    classes: [cls({ klass: 0, code: 'H15', n: 120, cells: many })],
    counts: [row({ code: 'H15', sheet: 120, prior: 120, classes: [0] })],
  });
  const { container } = render(
    <SheetReview sheet={s} onPatchClasses={vi.fn()} onPatchPrior={vi.fn()} onPatchCells={vi.fn()} />,
  );
  expect(container.querySelectorAll('.cell-hit')).toHaveLength(50);
  expect(screen.getByText(/第 1 \/ 3 页/)).toBeInTheDocument();
});

it('没选豆点时提示去左栏改整类', () => {
  setup();
  expect(screen.getByText(/改整个色号请用左边那一栏/)).toBeInTheDocument();
});
