/**
 * 网格确认。
 *
 * canvas 在 jsdom 下画不出东西，所以这里只验证 DOM 状态和交互后传出去的数字；
 * 几何算术本身在 lib/sheetGeometry.test.ts 里已经钉死了。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SheetGuess } from '../../api/types';
import { stubCanvas2D } from '../../test/setup';
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

beforeEach(() => {
  stubCanvas2D();
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
