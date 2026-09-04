/**
 * 生成图纸的框选。
 *
 * 和 GridConfirm 长得像，但有一条它没有的硬约束：**框的比例必须等于 cols:rows**。
 * 比例一歪豆子就被拉长，而那是成品摆出来之前看不出来的错误——所以这里主要盯它。
 * 几何算术本身在 lib/cropBox.test.ts 里已经钉死了。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SheetGuess } from '../../api/types';
import { type Ctx2DStub, stubCanvas2D } from '../../test/setup';
import CropConfirm from './CropConfirm';

const GUESS: SheetGuess = {
  id: 1, width: 400, height: 400, rect: [0, 0, 400, 400],
  rows: 0, cols: 0, snap_x: [], snap_y: [], source: 'manual',
};

function stubImage() {
  class ImageStub {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  }
  vi.stubGlobal('Image', ImageStub);
}

function sizeStage(w = 400, h = 400) {
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
    configurable: true, get: () => w,
  });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
    configurable: true, get: () => h,
  });
}

let ctx: Ctx2DStub;
beforeEach(() => {
  ctx = stubCanvas2D();
  stubImage();
  sizeStage();
});

function setup() {
  const onConfirm = vi.fn();
  render(<CropConfirm guess={GUESS} onConfirm={onConfirm} />);
  return onConfirm;
}

/** 交出去的框的宽高比。 */
function ratioOf(spec: { rect: number[] }) {
  const [x0, y0, x1, y1] = spec.rect as [number, number, number, number];
  return (x1 - x0) / (y1 - y0);
}

function confirm(onConfirm: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: '生成图纸' }));
  return onConfirm.mock.calls[0]![0];
}

it('默认框住图片正中最大的一块', () => {
  const onConfirm = setup();
  // 默认 50x50，正方形图 -> 整张
  expect(confirm(onConfirm).rect).toEqual([0, 0, 400, 400]);
});

it('交出去的是完整的生成参数', () => {
  const onConfirm = setup();
  expect(confirm(onConfirm)).toMatchObject({
    rows: 50, cols: 50, palette: '221', style: 'slic', clean: true,
  });
});

// ---------- 比例锁死 ----------

it('改了行列数，框跟着换比例', () => {
  const onConfirm = setup();
  fireEvent.change(screen.getByLabelText('列数'), { target: { value: '100' } });
  expect(ratioOf(confirm(onConfirm))).toBeCloseTo(2, 3); // 100 列 50 行
});

it('比例是 cols:rows，不是反过来——反了豆子会被拉长', () => {
  const onConfirm = setup();
  fireEvent.change(screen.getByLabelText('行数'), { target: { value: '100' } });
  expect(ratioOf(confirm(onConfirm))).toBeCloseTo(0.5, 3); // 50 列 100 行 = 竖的
});

it('拖角点改大小时比例照旧锁死', async () => {
  const onConfirm = setup();
  fireEvent.change(screen.getByLabelText('列数'), { target: { value: '150' } });
  const canvas = screen.getByLabelText('框选范围');
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0 }) as DOMRect;
  await waitFor(() => expect(ctx.drawImage).toHaveBeenCalled());

  const grip = screen.getByLabelText('右下角点');
  fireEvent.pointerDown(grip, { clientX: 300, clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(grip, { clientX: 200, clientY: 260, pointerId: 1 });
  fireEvent.pointerUp(grip, { pointerId: 1 });
  expect(ratioOf(confirm(onConfirm))).toBeCloseTo(3, 3);
});

it('框永远不会跑到图片外面——外面没有像素可切', async () => {
  const onConfirm = setup();
  fireEvent.change(screen.getByLabelText('列数'), { target: { value: '25' } });
  const grip = screen.getByLabelText('左上角点');
  fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(grip, { clientX: -900, clientY: -900, pointerId: 1 });
  fireEvent.pointerUp(grip, { pointerId: 1 });
  const r = confirm(onConfirm).rect;
  expect(r[0]).toBeGreaterThanOrEqual(0);
  expect(r[1]).toBeGreaterThanOrEqual(0);
  expect(r[2]).toBeLessThanOrEqual(400);
  expect(r[3]).toBeLessThanOrEqual(400);
});

// ---------- 挪框 ----------

it('在框里拖动是挪框，大小不变', async () => {
  const onConfirm = setup();
  const canvas = screen.getByLabelText('框选范围');
  await waitFor(() => expect(ctx.drawImage).toHaveBeenCalled());

  // 默认框满整张图，先把右下角收进来，腾出可以挪的空间
  const grip = screen.getByLabelText('右下角点');
  fireEvent.pointerDown(grip, { clientX: 400, clientY: 400, pointerId: 1 });
  fireEvent.pointerMove(grip, { clientX: 200, clientY: 200, pointerId: 1 });
  fireEvent.pointerUp(grip, { pointerId: 1 });
  const before = confirm(onConfirm).rect;
  expect(before).toEqual([0, 0, 200, 200]);

  fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 2 });
  fireEvent.pointerMove(canvas, { clientX: 140, clientY: 140, pointerId: 2 });
  fireEvent.pointerUp(canvas, { pointerId: 2 });

  fireEvent.click(screen.getByRole('button', { name: '生成图纸' }));
  const after = onConfirm.mock.calls[1]![0].rect;
  expect(after).toEqual([40, 40, 240, 240]);
});

it('框外拖动是平移视图，框纹丝不动', async () => {
  const onConfirm = setup();
  const canvas = screen.getByLabelText('框选范围');
  await waitFor(() => expect(ctx.drawImage).toHaveBeenCalled());

  const grip = screen.getByLabelText('右下角点');
  fireEvent.pointerDown(grip, { clientX: 400, clientY: 400, pointerId: 1 });
  fireEvent.pointerMove(grip, { clientX: 150, clientY: 150, pointerId: 1 });
  fireEvent.pointerUp(grip, { pointerId: 1 });
  const before = confirm(onConfirm).rect;

  // (300,300) 在框外面
  fireEvent.pointerDown(canvas, { clientX: 300, clientY: 300, pointerId: 2 });
  fireEvent.pointerMove(canvas, { clientX: 330, clientY: 300, pointerId: 2 });
  fireEvent.pointerUp(canvas, { pointerId: 2 });

  fireEvent.click(screen.getByRole('button', { name: '生成图纸' }));
  expect(onConfirm.mock.calls[1]![0].rect).toEqual(before);
  const calls = ctx.drawImage.mock.calls;
  expect(Number(calls[calls.length - 1]![1])).toBe(30);   // 图挪了 30
});

// ---------- 画面 ----------

it('框外面压暗——用户要一眼看出选的是哪一块', () => {
  setup();
  expect(ctx.fillStyleLog).toContain('rgba(0,0,0,0.55)');
});

it('画布把竖向划动让给页面滚动，角点命中块自己扣下来', () => {
  setup();
  expect(screen.getByLabelText('框选范围').style.touchAction).toBe('pan-y');
  expect(screen.getByLabelText('右下角点')).toHaveClass('grid-corner');
});

it('拖角点时出来放大镜，松手收起', async () => {
  setup();
  await waitFor(() => expect(ctx.drawImage).toHaveBeenCalled());
  expect(screen.queryByLabelText('放大镜')).toBeNull();
  const grip = screen.getByLabelText('左上角点');
  fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, pointerId: 1 });
  expect(screen.getByLabelText('放大镜')).toBeInTheDocument();
  fireEvent.pointerUp(grip, { pointerId: 1 });
  expect(screen.queryByLabelText('放大镜')).toBeNull();
});

// ---------- 生成参数 ----------

it('两种生成方式都给得出来', () => {
  const onConfirm = setup();
  fireEvent.change(screen.getByLabelText('生成方式'), { target: { value: 'dpid' } });
  expect(confirm(onConfirm).style).toBe('dpid');
});

it('去孤点可以关掉', () => {
  const onConfirm = setup();
  fireEvent.click(screen.getByLabelText(/去掉孤立的单颗豆子/));
  expect(confirm(onConfirm).clean).toBe(false);
});

it('色卡可以切到 291', () => {
  const onConfirm = setup();
  fireEvent.change(screen.getByLabelText('色卡'), { target: { value: '291' } });
  expect(confirm(onConfirm).palette).toBe('291');
});

it('行列数填 0 就不能生成', () => {
  setup();
  fireEvent.change(screen.getByLabelText('行数'), { target: { value: '0' } });
  expect(screen.getByRole('button', { name: '生成图纸' })).toBeDisabled();
});
