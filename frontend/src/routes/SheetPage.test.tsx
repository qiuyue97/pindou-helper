/**
 * 三段式：上传 → 确认网格 → 校对。
 *
 * 识别不出来**不是失败**：MinerU 挂了、没配 token、这张图没有颜色结构，产出的都是
 * 一张全红的矩阵，用户可以从零改。界面要如实说明发生了什么，而不是报错了事。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Sheet } from '../api/types';
import { ToastProvider } from '../state/ToastContext';
import { stubCanvas2D } from '../test/setup';
import { mockFetch } from '../test/utils';
import SheetPage from './SheetPage';

let vip = true;

vi.mock('../state/useVip', () => ({
  VIP_UPSELL: '请升级VIP获取服务',
  useVip: () => ({ isVip: vip, guard: (f: () => void) => f }),
}));

vi.mock('../state/useEffectiveCatalog', () => ({
  useEffectiveCatalog: () => ({
    colors: [{ code: 'H15', series: 'H', hex: '00FF00', source: 'base' }],
    byCode: new Map([['H15', { code: 'H15', hex: '00FF00' }]]),
    isLoading: false,
  }),
}));

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    id: 1,
    status: 'done',
    width: 100,
    height: 100,
    rect: [0, 0, 20, 20],
    rows: 2,
    cols: 2,
    has_blanks: false,
    palette: '221',
    snap_x: [],
    snap_y: [],
    labels: [0, 0, 0, 0],
    classes: [
      {
        klass: 0,
        code: 'H15',
        source: 'ocr',
        level: 'ok',
        de: 0.5,
        n: 4,
        radius: 1,
        rgb: [0, 255, 0],
        nearest: 'H15',
        nearest_de: 0.5,
        read_full: 'H15',
        off_list: false,
        dup: null,
        cells: [0, 1, 2, 3],
      },
    ],
    counts: [{ code: 'H15', sheet: 4, prior: 4, classes: [0], level: 'ok' }],
    overrides: {},
    prior: { H15: 4 },
    engine: 'mineru/vlm',
    structured: true,
    error: '',
    seen: false,
    tally: { H15: 4 },
    created_at: '2026-09-02T00:00:00Z',
    finished_at: '2026-09-02T00:01:00Z',
    ...over,
  };
}

function show(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vip = true;
  stubCanvas2D();
});

it('普通账号看得见入口，点了给升级提示', () => {
  vip = false;
  show(<SheetPage />);
  expect(screen.getByText(/请升级VIP/)).toBeInTheDocument();
  expect(screen.queryByLabelText('选择图纸')).toBeNull();
});

it('一开始只有上传', () => {
  mockFetch({});
  show(<SheetPage />);
  expect(screen.getByLabelText('选择图纸')).toBeInTheDocument();
  expect(screen.queryByLabelText('网格范围')).toBeNull();
});

it('识别中显示进度而不是空白', async () => {
  mockFetch({ 'GET /api/sheets/1': { body: sheet({ status: 'running' }) } });
  show(<SheetPage sheetId={1} />);
  expect(await screen.findByText(/正在识别/)).toBeInTheDocument();
});

it('真失败时把原因显示出来', async () => {
  mockFetch({
    'GET /api/sheets/1': { body: sheet({ status: 'failed', error: '图片已不存在' }) },
  });
  show(<SheetPage sheetId={1} />);
  expect(await screen.findByText('图片已不存在')).toBeInTheDocument();
});

it('没有颜色结构时如实说明，而不是报错', async () => {
  mockFetch({
    'GET /api/sheets/1': { body: sheet({ structured: false, engine: 'colour-only' }) },
  });
  show(<SheetPage sheetId={1} />);
  expect(await screen.findByText(/没有颜色结构/)).toBeInTheDocument();
  expect(screen.getByLabelText('色号对账')).toBeInTheDocument();
});

it('MinerU 没用上时说明是按颜色猜的', async () => {
  mockFetch({
    'GET /api/sheets/1': { body: sheet({ structured: true, engine: 'colour-only' }) },
  });
  show(<SheetPage sheetId={1} />);
  expect(await screen.findByText(/没有读出色号/)).toBeInTheDocument();
});

it('没有先验时说明没有第二份证据可对账', async () => {
  mockFetch({ 'GET /api/sheets/1': { body: sheet({ prior: {} }) } });
  show(<SheetPage sheetId={1} />);
  expect(await screen.findByText(/没有第二份证据/)).toBeInTheDocument();
});

it('一切正常时不显示任何提示', async () => {
  mockFetch({ 'GET /api/sheets/1': { body: sheet() } });
  const { container } = show(<SheetPage sheetId={1} />);
  await screen.findByLabelText('色号对账');
  expect(container.querySelector('.sheet-notices')).toBeNull();
});

it('完成后完整图纸画在操作区上方', async () => {
  mockFetch({ 'GET /api/sheets/1': { body: sheet() } });
  show(<SheetPage sheetId={1} />);
  const canvas = await screen.findByLabelText('完整图纸');
  const table = screen.getByLabelText('色号对账');
  expect(canvas.compareDocumentPosition(table)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it('对账表在格子区上面——先看整类，再看例外', async () => {
  mockFetch({ 'GET /api/sheets/1': { body: sheet() } });
  const { container } = show(<SheetPage sheetId={1} />);
  const table = await screen.findByLabelText('色号对账');
  const review = container.querySelector('.cell-review')!;
  expect(table.compareDocumentPosition(review)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it('一键把修正后的清单送去按图扣减，按色号顺序排', async () => {
  mockFetch({
    'GET /api/sheets/1': { body: sheet({ tally: { A10: 3, A2: 5 } }) },
    'GET /api/inventory': { body: [] },
    'GET /api/colors': { body: [] },
  });
  show(<SheetPage sheetId={1} />);
  fireEvent.click(await screen.findByRole('button', { name: /按图扣减/ }));
  await waitFor(() => {
    const box = screen.getByRole('textbox');
    expect((box as HTMLTextAreaElement).value).toBe('A2, 5\nA10, 3');
  });
});
