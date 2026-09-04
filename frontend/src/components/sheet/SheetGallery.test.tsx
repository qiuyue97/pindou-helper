/**
 * 我的图纸：缩略图墙。
 *
 * 原来是一列纯文字链接。图纸是**靠看认出来的**——十张 65×65 的行列数一模一样，
 * 日期也记不住，光靠 id 分不出哪张是哪张。所以这里盯三件事：缩略图确实是缩略图
 * 接口（不是几 MB 的原图）、命名/删除/排序都真的发了请求、以及拖动之后不会顺手
 * 把图纸点开。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Sheet } from '../../api/types';
import { ToastProvider } from '../../state/ToastContext';
import { lastRequest, mockFetch } from '../../test/utils';
import SheetGallery from './SheetGallery';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    id: 1, kind: 'recognise', name: '', position: 0, status: 'done',
    width: 100, height: 100, rect: [0, 0, 20, 20], rows: 65, cols: 65,
    has_blanks: false, palette: '221', snap_x: [], snap_y: [],
    labels: [], classes: [], counts: [], overrides: {}, prior: {},
    engine: 'mineru/vlm', step: '', progress: 100, structured: true, error: '', seen: true, tally: {},
    created_at: '2026-09-04T01:05:03Z', finished_at: null,
    ...over,
  } as Sheet;
}

function show(sheets: Sheet[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <SheetGallery sheets={sheets} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const THREE = [sheet({ id: 3 }), sheet({ id: 2 }), sheet({ id: 1 })];

beforeEach(() => {
  navigate.mockClear();
  mockFetch({ 'GET /api/sheets': { body: { sheets: THREE, running: 0 } } });
});

it('一张都没有时整块不显示', () => {
  show([]);
  expect(screen.queryByText('我的图纸')).toBeNull();
});

it('缩略图走 /thumb，不是几 MB 的原图', () => {
  const { container } = show([sheet({ id: 7 })]);
  const img = container.querySelector('img.sheet-thumb') as HTMLImageElement;
  expect(img.getAttribute('src')).toContain('/api/sheets/7/thumb');
  expect(img.getAttribute('loading')).toBe('lazy'); // 一屏十几张，别一次全拉
});

it('URL 带缓存记号：删掉一张再传一张会重用 id，光靠 id 会端出旧缩略图', () => {
  const { container, rerender } = show([
    sheet({ id: 7, created_at: '2026-09-04T01:05:03Z' }),
  ]);
  const first = container.querySelector('img.sheet-thumb')!.getAttribute('src');

  // 同一个 id，另一张图纸（原来那张被删了，新传的捡到了 17 号）
  rerender(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter>
          <SheetGallery sheets={[sheet({ id: 7, created_at: '2026-09-04T16:20:00Z' })]} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  expect(container.querySelector('img.sheet-thumb')!.getAttribute('src')).not.toBe(first);
});

it('没起名字的显示 #id，起过名字的显示名字', () => {
  show([sheet({ id: 7 }), sheet({ id: 8, name: '小熊' })]);
  expect(screen.getByText('#7')).toBeInTheDocument();
  expect(screen.getByText('小熊')).toBeInTheDocument();
});

it('点缩略图打开这张图纸', () => {
  show([sheet({ id: 7 })]);
  fireEvent.click(screen.getByRole('button', { name: '打开 #7' }));
  expect(navigate).toHaveBeenCalledWith('/sheet/7');
});

// ---------- 命名 ----------

it('改名把新名字发上去', async () => {
  show([sheet({ id: 7 })]);
  fireEvent.click(screen.getByRole('button', { name: '改名 #7' }));
  const input = screen.getByLabelText('给 #7 起名字');
  fireEvent.change(input, { target: { value: '小熊' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() =>
    expect(lastRequest('PATCH', '/api/sheets/7/name')).toBeDefined(),
  );
  expect(JSON.parse(String(lastRequest('PATCH', '/api/sheets/7/name')!.init!.body))).toEqual({
    name: '小熊',
  });
});

it('Esc 放弃改名，什么都不发', () => {
  show([sheet({ id: 7 })]);
  fireEvent.click(screen.getByRole('button', { name: '改名 #7' }));
  fireEvent.keyDown(screen.getByLabelText('给 #7 起名字'), { key: 'Escape' });
  expect(screen.queryByLabelText('给 #7 起名字')).toBeNull();
  expect(lastRequest('PATCH', '/api/sheets/7/name')).toBeUndefined();
});

// ---------- 删除 ----------

it('删除要先确认——一张图纸删掉就没了', async () => {
  show([sheet({ id: 7 })]);
  fireEvent.click(screen.getByRole('button', { name: '删除 #7' }));
  expect(lastRequest('DELETE', '/api/sheets/7')).toBeUndefined();

  expect(screen.getByText('删掉这张？')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await waitFor(() => expect(lastRequest('DELETE', '/api/sheets/7')).toBeDefined());
});

it('确认框里点取消就什么都不做', () => {
  show([sheet({ id: 7 })]);
  fireEvent.click(screen.getByRole('button', { name: '删除 #7' }));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByText('删掉这张？')).toBeNull();
  expect(lastRequest('DELETE', '/api/sheets/7')).toBeUndefined();
});

// ---------- 拖拽排序 ----------

/** 从把手起手，拖到 `onto` 那张卡片上，松手。 */
function drag(container: HTMLElement, from: number, onto: number) {
  const grip = screen.getByLabelText(`拖动排序 #${from}`);
  const target = container.querySelector(`[data-sheet-id="${onto}"]`)!;
  fireEvent.pointerDown(grip, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
  fireEvent.pointerMove(target, { pointerId: 1, pointerType: 'touch', clientX: 90, clientY: 0 });
  fireEvent.pointerUp(target, { pointerId: 1 });
}

it('从把手拖到另一张上，把整份新顺序发上去', async () => {
  const { container } = show(THREE);
  drag(container, 3, 1);
  await waitFor(() => expect(lastRequest('PUT', '/api/sheets/order')).toBeDefined());
  expect(JSON.parse(String(lastRequest('PUT', '/api/sheets/order')!.init!.body))).toEqual({
    ids: [2, 1, 3],
  });
});

it('把手不用等长按——它自己就是 touch-action: none 的那条路', () => {
  show(THREE);
  expect(screen.getByLabelText('拖动排序 #3')).toHaveClass('sheet-card-grip');
});

it('拖到自己身上不算改动，一个请求都不发', () => {
  const { container } = show(THREE);
  drag(container, 3, 3);
  expect(lastRequest('PUT', '/api/sheets/order')).toBeUndefined();
});

it('拖完手指抬起补的那一下 click 不能把图纸打开', () => {
  const { container } = show(THREE);
  drag(container, 3, 1);
  fireEvent.click(screen.getByRole('button', { name: '打开 #3' }));
  expect(navigate).not.toHaveBeenCalled();
});

it('手指按下就直接滑走的算滑页面，不进拖动', () => {
  const { container } = show(THREE);
  const card = container.querySelector('[data-sheet-id="3"]')!;
  const other = container.querySelector('[data-sheet-id="1"]')!;
  // 没经过把手、也没按住不动，一按就走
  fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
  fireEvent.pointerMove(other, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 60 });
  fireEvent.pointerUp(other, { pointerId: 1 });
  expect(lastRequest('PUT', '/api/sheets/order')).toBeUndefined();
});

it('鼠标不用等长按，拖出去就开始', async () => {
  const { container } = show(THREE);
  const card = container.querySelector('[data-sheet-id="3"]')!;
  const other = container.querySelector('[data-sheet-id="1"]')!;
  fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0 });
  fireEvent.pointerMove(other, { pointerId: 1, pointerType: 'mouse', clientX: 40, clientY: 0 });
  fireEvent.pointerUp(other, { pointerId: 1 });
  await waitFor(() => expect(lastRequest('PUT', '/api/sheets/order')).toBeDefined());
});

it('触摸起手先放掉隐式捕获，否则拖过的卡片一张都认不出来', () => {
  show(THREE);
  const grip = screen.getByLabelText('拖动排序 #3');
  vi.spyOn(grip, 'hasPointerCapture').mockReturnValue(true);
  const release = vi.spyOn(grip, 'releasePointerCapture');
  fireEvent.pointerDown(grip, { pointerId: 9, pointerType: 'touch' });
  expect(release).toHaveBeenCalledWith(9);
});


// ---------- 两类分开列 ----------
//
// 识别来的和照片转的**能做的事不一样**（后者不逐格改色），混在一起光看缩略图
// 分不出来——点进去才发现界面不一样，比多一个小标题烦人得多。

it('两类都有时各列一组', () => {
  show([sheet({ id: 1 }), sheet({ id: 2, kind: 'generate' })]);
  expect(screen.getByText('识别的图纸')).toBeInTheDocument();
  expect(screen.getByText('图片转的图纸')).toBeInTheDocument();
});

it('只有一类时不显示小标题——那是废话', () => {
  show([sheet({ id: 1 }), sheet({ id: 2 })]);
  expect(screen.queryByText('识别的图纸')).toBeNull();
  expect(screen.queryByText('图片转的图纸')).toBeNull();
});

it('卡片分进各自那一组', () => {
  const { container } = show([
    sheet({ id: 1, name: '识别来的' }),
    sheet({ id: 2, kind: 'generate', name: '转出来的' }),
  ]);
  const groups = container.querySelectorAll('.sheet-group');
  expect(groups).toHaveLength(2);
  expect(groups[0]!).toHaveTextContent('识别来的');
  expect(groups[0]!).not.toHaveTextContent('转出来的');
  expect(groups[1]!).toHaveTextContent('转出来的');
});

it('老记录没有 kind 时当识别处理，不会凭空消失', () => {
  const legacy = { ...sheet({ id: 5, name: '老图' }) } as Sheet;
  // biome-ignore lint/performance/noDelete: 就是要模拟字段不存在
  delete (legacy as { kind?: unknown }).kind;
  show([legacy]);
  expect(screen.getByText('老图')).toBeInTheDocument();
});
