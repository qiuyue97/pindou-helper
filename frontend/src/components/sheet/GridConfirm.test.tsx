/**
 * 网格确认。
 *
 * canvas 在 jsdom 下画不出东西，所以这里只验证 DOM 状态和交互后传出去的数字；
 * 几何算术本身在 lib/sheetGeometry.test.ts 里已经钉死了。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SheetGuess } from '../../api/types';
import { type Ctx2DStub, stubCanvas2D } from '../../test/setup';
import GridConfirm from './GridConfirm';

const GUESS: SheetGuess = {
  id: 1,
  width: 400,
  height: 300,
  rect: [40, 40, 340, 260],
  rows: 22,
  cols: 30,
  snap_x: [40, 50, 340],
  snap_y: [40, 50, 260],
  source: 'lattice',
};

/** jsdom 不会真去加载图片，onload 永远不响。异步触发，和真实情况一致。 */
function stubImage(fail = false) {
  class ImageStub {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      setTimeout(() => (fail ? this.onerror?.() : this.onload?.()), 0);
    }
  }
  vi.stubGlobal('Image', ImageStub);
}

let ctx: Ctx2DStub;
beforeEach(() => {
  ctx = stubCanvas2D();
  stubImage();
});

function setup(guess: Partial<SheetGuess> = {}) {
  const onConfirm = vi.fn();
  render(<GridConfirm guess={{ ...GUESS, ...guess }} onConfirm={onConfirm} />);
  return onConfirm;
}

/** canvas 有 width/height 属性但 jsdom 里 getBoundingClientRect 全是 0，
 *  自己造一个 1:1 的盒子，坐标换算才有意义。 */
function sizeCanvas(el: HTMLElement, w = 400, h = 300) {
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0 }) as DOMRect;
}

it('把检测出的行列数填进去', () => {
  setup();
  expect(screen.getByLabelText('行数')).toHaveValue(22);
  expect(screen.getByLabelText('列数')).toHaveValue(30);
});

it('检测失败时提示用户自己拖框', () => {
  setup({ source: 'manual', rows: 0, cols: 0, snap_x: [], snap_y: [] });
  expect(screen.getByText(/没有自动找到/)).toBeInTheDocument();
});

it('行列数没填就不能开始识别', () => {
  setup({ source: 'manual', rows: 0, cols: 0 });
  expect(screen.getByRole('button', { name: '开始识别' })).toBeDisabled();
});

it('确认时把几何交出去', () => {
  const onConfirm = setup();
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
  expect(onConfirm).toHaveBeenCalledWith({
    rect: [40, 40, 340, 260],
    rows: 22,
    cols: 30,
    has_blanks: false,
    palette: '221',
  });
});

it('「有空格子」是用户勾的，不是猜的', () => {
  const onConfirm = setup();
  fireEvent.click(screen.getByLabelText(/有空格子/));
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
  expect(onConfirm.mock.calls[0]![0].has_blanks).toBe(true);
});

it('色卡默认 221，可以切到 291', () => {
  const onConfirm = setup();
  expect(screen.getByLabelText('色卡')).toHaveValue('221');
  fireEvent.change(screen.getByLabelText('色卡'), { target: { value: '291' } });
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
  expect(onConfirm.mock.calls[0]![0].palette).toBe('291');
});

it('改行列数会带进确认结果', () => {
  const onConfirm = setup();
  fireEvent.change(screen.getByLabelText('行数'), { target: { value: '49' } });
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
  expect(onConfirm.mock.calls[0]![0].rows).toBe(49);
});

it('画布上禁掉浏览器的触摸手势，否则拖角会变成滚页面', () => {
  setup();
  expect(screen.getByLabelText('网格范围').style.touchAction).toBe('none');
});

it('拖一个角会吸附到真实分隔线上', () => {
  const onConfirm = setup();
  const canvas = screen.getByLabelText('网格范围');
  sizeCanvas(canvas);
  fireEvent.pointerDown(canvas, { clientX: 40, clientY: 40, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 52, clientY: 52, pointerId: 1 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
  // 52 落在靶点 50 的容差内，被吸过去
  expect(onConfirm.mock.calls[0]![0].rect.slice(0, 2)).toEqual([50, 50]);
});

it('点在框中间不会误抓角点', () => {
  const onConfirm = setup();
  const canvas = screen.getByLabelText('网格范围');
  sizeCanvas(canvas);
  fireEvent.pointerDown(canvas, { clientX: 200, clientY: 150, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 210, clientY: 160, pointerId: 1 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
  expect(onConfirm.mock.calls[0]![0].rect).toEqual([40, 40, 340, 260]);
});

it('检测失败时没有靶点，拖到哪就是哪', () => {
  const onConfirm = setup({ source: 'manual', rows: 5, cols: 5, snap_x: [], snap_y: [] });
  const canvas = screen.getByLabelText('网格范围');
  sizeCanvas(canvas);
  fireEvent.pointerDown(canvas, { clientX: 40, clientY: 40, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 52, clientY: 52, pointerId: 1 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
  expect(onConfirm.mock.calls[0]![0].rect.slice(0, 2)).toEqual([52, 52]);
});

it('触摸的命中半径更大——手指没有像素精度', () => {
  const onConfirm = setup({ snap_x: [], snap_y: [] });
  const canvas = screen.getByLabelText('网格范围');
  sizeCanvas(canvas);
  // 距左上角 hypot(25,25)≈35：鼠标够不着
  fireEvent.pointerDown(canvas, { clientX: 65, clientY: 65, pointerId: 1, pointerType: 'mouse' });
  fireEvent.pointerMove(canvas, { clientX: 70, clientY: 70, pointerId: 1, pointerType: 'mouse' });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
  expect(onConfirm.mock.calls[0]![0].rect).toEqual([40, 40, 340, 260]);

  // 同一个点，手指够得着
  fireEvent.pointerDown(canvas, { clientX: 65, clientY: 65, pointerId: 2, pointerType: 'touch' });
  fireEvent.pointerMove(canvas, { clientX: 70, clientY: 70, pointerId: 2, pointerType: 'touch' });
  fireEvent.pointerUp(canvas, { pointerId: 2 });
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
  expect(onConfirm.mock.calls[1]![0].rect.slice(0, 2)).toEqual([70, 70]);
});

it('大图也拖得动角点——命中半径是屏幕像素，不是图像像素', () => {
  // 4096x3000 的图显示成 900px 宽：缩放比 ≈4.55
  const onConfirm = setup({
    width: 4096,
    height: 3000,
    rect: [100, 100, 3900, 2800],
    snap_x: [],
    snap_y: [],
  });
  const canvas = screen.getByLabelText('网格范围');
  sizeCanvas(canvas, 900, 659);

  // 左上角 (100,100) 图像坐标 → 屏幕上约 (22,22)。在它旁边 10 屏幕像素处按下，
  // 换算回图像空间是 45 像素——如果半径没做换算（22 图像像素），就抓不到。
  fireEvent.pointerDown(canvas, { clientX: 32, clientY: 32, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));

  const moved = onConfirm.mock.calls[0]![0].rect;
  expect(moved[0]).not.toBe(100);
  expect(moved[1]).not.toBe(100);
});

it('小图上命中半径不会大到误抓', () => {
  const onConfirm = setup({ snap_x: [], snap_y: [] });
  const canvas = screen.getByLabelText('网格范围');
  sizeCanvas(canvas, 400, 300); // 1:1
  // 距角 100px，无论如何都不该抓到
  fireEvent.pointerDown(canvas, { clientX: 140, clientY: 140, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 150, clientY: 150, pointerId: 1 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
  expect(onConfirm.mock.calls[0]![0].rect).toEqual([40, 40, 340, 260]);
});


// ---------- 底图 ----------

it('原图一到就画上去，不用等用户去拖角点', async () => {
  // 原来底图存在 ref 里，靠强制重渲染显示；可绘制那个 effect 的依赖是
  // [rect, rows, cols]，重渲染不会让它重跑——底图于是永远不画，屏幕上只剩一片
  // 绿网格，点哪都像没反应。
  setup();
  await waitFor(() => expect(ctx.drawImage).toHaveBeenCalled());
});

it('载入中说一声', () => {
  setup();
  expect(screen.getByText(/正在载入原图/)).toBeInTheDocument();
});

it('原图没了就说清楚', async () => {
  stubImage(true);
  setup();
  expect(await screen.findByText(/原图已不存在/)).toBeInTheDocument();
});

it('画布高度不超过一屏，否则角点和下面的按钮都在屏幕外', () => {
  setup({ width: 4096, height: 6044 });
  const canvas = screen.getByLabelText('网格范围');
  expect(canvas.style.maxWidth).toBe(`calc(70vh * ${4096 / 6044})`);
});
