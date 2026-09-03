/**
 * 屏幕上的图纸和下载的图纸必须是同一张。
 *
 * 这两处一度是各画各的：屏幕上一格一个纯色方块，下载的才是带网格线、格内色号、
 * 底部汇总的正式图纸。用户照着屏幕拼，拿到的文件却是另一回事。现在共用
 * sheetToDrawing + drawSheet，这里就盯着「预览确实画了正式图纸该有的东西」。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Sheet } from '../../api/types';
import { dimHex } from '../../lib/sheetExport';
import { type Ctx2DStub, stubCanvas2D } from '../../test/setup';
import SheetPreview from './SheetPreview';

vi.mock('../../state/useEffectiveCatalog', () => ({
  useEffectiveCatalog: () => ({
    colors: [],
    byCode: new Map([
      ['H15', { code: 'H15', hex: '00FF00' }],
      ['B8', { code: 'B8', hex: '0000FF' }],
    ]),
    isLoading: false,
  }),
}));

function makeSheet(over: Partial<Sheet> = {}): Sheet {
  return {
    id: 1, rows: 2, cols: 2, rect: [0, 0, 20, 20], palette: '221',
    labels: [0, 0, 1, 1],
    classes: [
      { klass: 0, code: 'H15' },
      { klass: 1, code: 'B8' },
    ],
    overrides: {},
    tally: { H15: 2, B8: 2 },
    ...over,
  } as unknown as Sheet;
}

let ctx: Ctx2DStub;
beforeEach(() => {
  ctx = stubCanvas2D();
});

/** 画在格子里和画在图例里的所有文字。 */
function texts(): string[] {
  return ctx.fillText.mock.calls.map((c) => String(c[0]));
}

it('每个格子里印着色号——不是一片纯色方块', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  expect(texts()).toContain('H15');
  expect(texts()).toContain('B8');
});

it('底部有色号汇总，带颗数', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  expect(texts()).toContain('2 颗');
});

it('有网格线', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  expect(ctx.stroke).toHaveBeenCalled();
});

it('画的是校对之后的归属：改过的格子按新色号画', () => {
  render(<SheetPreview sheet={makeSheet({ overrides: { '0,0': 'B8' }, tally: { H15: 1, B8: 3 } })} />);
  // 左上角本来是 H15，被改成 B8 了：四格里只剩一个 H15、三个 B8。
  // 每个色号在底部图例里还会再出现一次，所以这里是 1+1 和 3+1。
  expect(texts().filter((t) => t === 'H15')).toHaveLength(2);
  expect(texts().filter((t) => t === 'B8')).toHaveLength(4);
});

it('还没识别出行列时不画', () => {
  render(<SheetPreview sheet={makeSheet({ rows: 0, cols: 0 })} />);
  expect(screen.queryByLabelText('完整图纸')).toBeNull();
});

// ---------- 按色号突出显示 ----------

it('默认全部照常画', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  expect(ctx.fillStyleLog).toContain('#00FF00');
  expect(ctx.fillStyleLog).toContain('#0000FF');
});

it('选中一个色号，其余的压成灰', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  // 首次渲染画过一遍了，清掉再点，断言的才是「选中之后」画了什么
  ctx.fillStyleLog.length = 0;
  ctx.fillText.mock.calls.length = 0;
  fireEvent.click(screen.getByRole('button', { name: /H15/ }));
  expect(ctx.fillStyleLog).toContain('#00FF00');
  expect(ctx.fillStyleLog).toContain(`#${dimHex('0000FF')}`);
  // 选中的那两格还印着色号，没选中的不印
  expect(texts()).toContain('H15');
  expect(texts().filter((t) => t === 'B8')).toHaveLength(1); // 只剩底部汇总那一条
});

it('再点一下取消，全部恢复', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  const chip = screen.getByRole('button', { name: /H15/ });
  fireEvent.click(chip);
  ctx.fillStyleLog.length = 0;
  fireEvent.click(chip);
  expect(ctx.fillStyleLog).toContain('#0000FF');
});

it('「全部显示」一键还原', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  fireEvent.click(screen.getByRole('button', { name: /H15/ }));
  ctx.fillStyleLog.length = 0;
  fireEvent.click(screen.getByRole('button', { name: '全部显示' }));
  expect(ctx.fillStyleLog).toContain('#0000FF');
});

it('没选任何色号时不显示「全部显示」', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  expect(screen.queryByRole('button', { name: '全部显示' })).toBeNull();
});

// ---------- 缩放（滚轮 / 双指，没有 +/- 按钮）----------

it('没有 +/- 按钮', () => {
  render(<SheetPreview sheet={makeSheet()} />);
  expect(screen.queryByRole('button', { name: '放大' })).toBeNull();
  expect(screen.queryByRole('button', { name: '缩小' })).toBeNull();
});

it('滚轮向上是放大，且是重画不是 CSS 拉伸——canvas 像素数跟着涨', () => {
  const { container } = render(<SheetPreview sheet={makeSheet()} />);
  const canvas = container.querySelector('canvas')!;
  const scroll = container.querySelector('.preview-scroll')!;
  const w1 = canvas.width;

  fireEvent.wheel(scroll, { deltaY: -240 });
  expect(canvas.width).toBeGreaterThan(w1);
  // canvas 永远按自然像素画，从不设 CSS 宽度去拉伸
  expect(canvas.style.width).toBe('');
  expect(canvas.style.maxWidth).toBe('');
});

it('滚轮向下缩不到 1 倍以下', () => {
  const { container } = render(<SheetPreview sheet={makeSheet()} />);
  const canvas = container.querySelector('canvas')!;
  const scroll = container.querySelector('.preview-scroll')!;
  const w1 = canvas.width;

  fireEvent.wheel(scroll, { deltaY: 1000 });
  fireEvent.wheel(scroll, { deltaY: 1000 });
  expect(canvas.width).toBe(w1);
});

it('复位回到 1 倍', () => {
  const { container } = render(<SheetPreview sheet={makeSheet()} />);
  const scroll = container.querySelector('.preview-scroll')!;
  fireEvent.wheel(scroll, { deltaY: -240 });
  fireEvent.click(screen.getByRole('button', { name: '复位' }));
  expect(screen.getByText('滚轮或双指缩放')).toBeInTheDocument();
});

it('取景框宽高恒定：1 倍 hidden 不出条，放大后 auto 可滚动，但盒子尺寸不变', () => {
  const { container } = render(<SheetPreview sheet={makeSheet()} />);
  const scroll = container.querySelector('.preview-scroll') as HTMLElement;
  const w0 = scroll.style.width;
  const h0 = scroll.style.height;
  expect(scroll.style.overflow).toBe('hidden');

  fireEvent.wheel(scroll, { deltaY: -240 });
  expect(scroll.style.overflow).toBe('auto');
  // 关键：放大后取景框还是那么大，下方元素不会被顶动
  expect(scroll.style.width).toBe(w0);
  expect(scroll.style.height).toBe(h0);
});
