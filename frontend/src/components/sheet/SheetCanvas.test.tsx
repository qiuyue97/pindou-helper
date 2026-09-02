/**
 * 完整图纸。
 *
 * 服务端**不渲染任何图片**：前端有矩阵和色卡，画一遍就行。104×104 = 10,816 个
 * fillRect 对 canvas 来说是毫秒级的事，而同样数量的 DOM 节点会让 iOS 卡死。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Sheet } from '../../api/types';
import { stubCanvas2D } from '../../test/setup';
import SheetCanvas from './SheetCanvas';

vi.mock('../../state/useEffectiveCatalog', () => ({
  useEffectiveCatalog: () => ({
    colors: [],
    byCode: new Map([
      ['A1', { code: 'A1', hex: 'FF0000' }],
      ['H15', { code: 'H15', hex: '00FF00' }],
    ]),
    isLoading: false,
  }),
}));

const SHEET = {
  id: 1,
  rows: 2,
  cols: 2,
  labels: [0, 1, 1, 0],
  classes: [
    { klass: 0, code: 'A1' },
    { klass: 1, code: 'H15' },
  ],
  overrides: {},
} as unknown as Sheet;

let ctx: ReturnType<typeof stubCanvas2D>;

beforeEach(() => {
  ctx = stubCanvas2D();
});

it('每格画一次', () => {
  render(<SheetCanvas sheet={SHEET} />);
  expect(ctx.fillRect).toHaveBeenCalledTimes(4);
});

it('用色号的目录色填', () => {
  render(<SheetCanvas sheet={SHEET} />);
  expect(ctx.fillStyleLog).toContain('#FF0000');
  expect(ctx.fillStyleLog).toContain('#00FF00');
});

it('逐格覆盖会体现在图上', () => {
  render(<SheetCanvas sheet={{ ...SHEET, overrides: { '0,0': 'H15' } }} />);
  // 左上角本来是 A1，被覆盖成 H15：红色只剩一格
  expect(ctx.fillStyleLog.filter((c) => c === '#FF0000')).toHaveLength(1);
});

it('空格不画，露出底色', () => {
  render(<SheetCanvas sheet={{ ...SHEET, labels: [0, -1, -1, -1] }} />);
  expect(ctx.fillRect).toHaveBeenCalledTimes(1);
});

it('被高亮的格子额外描边', () => {
  render(<SheetCanvas sheet={SHEET} highlight={[0, 3]} />);
  expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
});

it('rows/cols 为 0 时不画也不崩', () => {
  render(<SheetCanvas sheet={{ ...SHEET, rows: 0, cols: 0, labels: [] }} />);
  expect(ctx.fillRect).not.toHaveBeenCalled();
});

it('一万格也是画布上的事，不产生 DOM 节点', () => {
  const rows = 104;
  const cols = 104;
  const big = {
    ...SHEET,
    rows,
    cols,
    labels: Array.from({ length: rows * cols }, (_, i) => i % 2),
  } as unknown as Sheet;
  const { container } = render(<SheetCanvas sheet={big} />);
  expect(ctx.fillRect).toHaveBeenCalledTimes(rows * cols);
  // 整个组件只有一个元素：canvas 本身
  expect(container.querySelectorAll('*')).toHaveLength(1);
});

it('点击换算回行列', () => {
  const onPickCell = vi.fn();
  render(<SheetCanvas sheet={SHEET} onPickCell={onPickCell} />);
  const canvas = screen.getByLabelText('完整图纸') as HTMLCanvasElement;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: canvas.width, height: canvas.height }) as DOMRect;
  const cell = canvas.width / 2;
  fireEvent.click(canvas, { clientX: cell * 1.5, clientY: cell * 0.5 });
  expect(onPickCell).toHaveBeenCalledWith(0, 1);
});

it('点在画布外不回调', () => {
  const onPickCell = vi.fn();
  render(<SheetCanvas sheet={SHEET} onPickCell={onPickCell} />);
  const canvas = screen.getByLabelText('完整图纸') as HTMLCanvasElement;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: canvas.width, height: canvas.height }) as DOMRect;
  fireEvent.click(canvas, { clientX: canvas.width * 2, clientY: 0 });
  expect(onPickCell).not.toHaveBeenCalled();
});
