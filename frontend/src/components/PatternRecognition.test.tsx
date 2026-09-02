import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import InventoryPage from '../routes/InventoryPage';
import CheckDialog from './CheckDialog';

const vipMe = { body: { username: 'amy', threshold: 500, is_vip: true } };
const plainMe = { body: { username: 'amy', threshold: 500 } };

const base = {
  'GET /api/colors': { body: [] },
  'GET /api/inventory': { body: [] },
  'GET /api/operations': { body: [] },
  'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
};

const job = (over: Record<string, unknown> = {}) => ({
  id: 1,
  status: 'done',
  bead_list: 'A1, 153\nC3, 20',
  md_table: '',
  note: '已从 2 张图片中共提取到 2 种色号',
  model: 'kimi-k3',
  error: '',
  extracted: true,
  seen: false,
  image_count: 2,
  items: [
    { index: 0, image_index: 0, filename: 'a.png', status: 'ok', error: '', notes: [] },
    { index: 1, image_index: 1, filename: 'b.png', status: 'ok', error: '', notes: [] },
  ],
  created_at: '2026-09-01T00:00:00Z',
  finished_at: '2026-09-01T00:01:00Z',
  ...over,
});

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'p.png', { type: 'image/png' });

const renderDialog = (onClose = vi.fn()) =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <CheckDialog onClose={onClose} />
      </ToastProvider>
    </AuthProvider>,
  );

const renderPage = () =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <InventoryPage />
      </ToastProvider>
    </AuthProvider>,
  );

describe('图纸识别的红点', () => {
  test('shows on 按图扣减 when a finished job has not been looked at', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': vipMe,
      'GET /api/patterns': { body: { jobs: [job()], unseen: 1, running: 0 } },
    });
    renderPage();
    const btn = await screen.findByRole('button', { name: /按图扣减/ });
    // Two chained queries have to land before the dot can appear: `me` decides
    // whether the VIP poll is even enabled, then `patterns` supplies the count.
    // The default 1s wait is not always enough when the whole suite is running.
    await screen.findByLabelText('1 个识别结果待查看', {}, { timeout: 5000 });
    expect(within(btn).getByLabelText('1 个识别结果待查看')).toBeInTheDocument();
  });

  test('stays hidden when everything has been seen', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': vipMe,
      'GET /api/patterns': { body: { jobs: [job({ seen: true })], unseen: 0, running: 0 } },
    });
    renderPage();
    const btn = await screen.findByRole('button', { name: /按图扣减/ });
    await waitFor(() => expect(screen.queryByLabelText(/识别结果待查看/)).not.toBeInTheDocument());
    expect(btn).toBeInTheDocument();
  });

  test('a normal account never polls the VIP endpoint', async () => {
    mockFetch({ ...base, 'GET /api/auth/me': plainMe });
    renderPage();
    await screen.findByRole('button', { name: /按图扣减/ });
    // enabled:false — 普通账号轮询只会拿到 403，白打
    await waitFor(() => expect(lastRequest('GET', '/api/patterns')).toBeUndefined());
  });
});

describe('发起识别', () => {
  test('uploads the picked images as multipart and says it runs in the background', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': vipMe,
      'GET /api/patterns': { body: { jobs: [], unseen: 0, running: 0 } },
      'POST /api/patterns': { body: job({ status: 'pending' }) },
    });
    renderDialog();

    await userEvent.upload(await screen.findByLabelText('上传图片'), [png(), png()]);
    await userEvent.click(screen.getByRole('button', { name: /开始识别（2 张）/ }));

    await waitFor(() => expect(lastRequest('POST', '/api/patterns')).toBeDefined());
    const body = lastRequest('POST', '/api/patterns')!.init!.body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).getAll('files')).toHaveLength(2);

    // 明确告诉用户可以走开
    expect(await screen.findByRole('status')).toHaveTextContent('可以先去做别的');
    // 提交后清空选择，避免重复提交同一批
    expect(screen.queryByRole('list', { name: '已选图片' })).not.toBeInTheDocument();
  });

  test('surfaces a rejected upload instead of pretending it started', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': vipMe,
      'GET /api/patterns': { body: { jobs: [], unseen: 0, running: 0 } },
      'POST /api/patterns': { status: 422, body: { detail: '不支持的图片格式: text/plain' } },
    });
    renderDialog();
    await userEvent.upload(await screen.findByLabelText('上传图片'), [png()]);
    await userEvent.click(screen.getByRole('button', { name: /开始识别/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('不支持的图片格式');
  });
});

describe('识别结果', () => {
  test('a finished job fills the demand list and clears the dot', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': vipMe,
      'GET /api/patterns': { body: { jobs: [job()], unseen: 1, running: 0 } },
      'POST /api/patterns/1/seen': { body: job({ seen: true }) },
    });
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: /填入清单/ }));

    // bead_list 的格式就是需求清单的格式，直接落进去
    expect(screen.getByLabelText('需求清单')).toHaveValue('A1, 153\nC3, 20');
    await waitFor(() => expect(lastRequest('POST', '/api/patterns/1/seen')).toBeDefined());
  });

  test('a running job says so and does not offer to fill anything', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': vipMe,
      'GET /api/patterns': {
        body: { jobs: [job({ status: 'running', bead_list: '' })], unseen: 0, running: 1 },
      },
    });
    renderDialog();
    expect(await screen.findByText(/识别中/)).toHaveTextContent('可以关掉这个窗口');
    expect(screen.queryByRole('button', { name: /填入清单/ })).not.toBeInTheDocument();
  });

  test('a failed job shows why', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': vipMe,
      'GET /api/patterns': {
        body: {
          jobs: [job({ status: 'failed', error: '所有模型都失败了', bead_list: '' })],
          unseen: 0,
          running: 0,
        },
      },
    });
    renderDialog();
    expect(await screen.findByText(/识别失败/)).toHaveTextContent('所有模型都失败了');
  });

  test('a normal account sees neither the uploader nor any job', async () => {
    mockFetch({ ...base, 'GET /api/auth/me': plainMe });
    renderDialog();
    expect(await screen.findByText('拼豆图纸AI抽取')).toBeInTheDocument();
    expect(screen.queryByLabelText('上传图片')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '识别任务' })).not.toBeInTheDocument();
  });
});

describe('每条记录的操作按钮', () => {
  const withJob = {
    ...base,
    'GET /api/auth/me': vipMe,
    'GET /api/patterns': {
      body: {
        jobs: [
          job({
            md_table:
              '| 色号 | 图片1 | 图片2 |\n| --- | --- | --- |\n| A3 | 105 |  |\n| 色号数量 | 1 | 0 |',
          }),
        ],
        unseen: 1,
        running: 0,
      },
    },
  };

  test('the icon buttons carry no text, only an accessible name', async () => {
    mockFetch(withJob);
    renderDialog();
    const detail = await screen.findByRole('button', { name: '查看各图明细' });
    const remove = screen.getByRole('button', { name: '删除这条记录' });
    // 图标按钮不写字；名字只给读屏和 tooltip 用
    expect(detail.textContent).toBe('');
    expect(remove.textContent).toBe('');
    // 只有"填入清单"保留文字
    expect(screen.getByRole('button', { name: '填入清单' }).textContent).toBe('填入清单');
  });

  test('deleting a record calls the API', async () => {
    mockFetch({ ...withJob, 'DELETE /api/patterns/1': { status: 204 } });
    renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: '删除这条记录' }));
    await waitFor(() => expect(lastRequest('DELETE', '/api/patterns/1')).toBeDefined());
    expect(await screen.findByRole('status')).toHaveTextContent('已删除');
  });

  test('the detail button opens the per-image breakdown', async () => {
    mockFetch(withJob);
    renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: '查看各图明细' }));

    const table = await screen.findByRole('table', { name: '各图色号明细' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '色号',
      '图片1',
      '图片2',
    ]);
    expect(within(table).getByText('A3')).toBeInTheDocument();
  });

  test('a 图片N header opens that image', async () => {
    mockFetch(withJob);
    renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: '查看各图明细' }));
    await userEvent.click(await screen.findByRole('button', { name: '图片2' }));

    // 图片2 是第二张，端点用的是 0 起的下标
    const img = await screen.findByAltText('识别用的第 2 张图');
    expect(img).toHaveAttribute('src', '/api/patterns/1/images/1');
  });

  test('a running record offers neither detail nor delete', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': vipMe,
      'GET /api/patterns': {
        body: { jobs: [job({ status: 'running', bead_list: '' })], unseen: 0, running: 1 },
      },
    });
    renderDialog();
    await screen.findByText(/识别中/);
    expect(screen.queryByRole('button', { name: '查看各图明细' })).not.toBeInTheDocument();
    // 正在跑的任务删了会留下没人管的线程，所以不给删
    expect(screen.queryByRole('button', { name: '删除这条记录' })).not.toBeInTheDocument();
  });

  test('a failed record can still be deleted', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': vipMe,
      'GET /api/patterns': {
        body: { jobs: [job({ status: 'failed', error: '网关超时' })], unseen: 0, running: 0 },
      },
      'DELETE /api/patterns/1': { status: 204 },
    });
    renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: '删除这条记录' }));
    await waitFor(() => expect(lastRequest('DELETE', '/api/patterns/1')).toBeDefined());
  });
});

describe('图里没有色号统计区域', () => {
  const noExtraction = {
    ...base,
    'GET /api/auth/me': vipMe,
    'GET /api/patterns': {
      body: {
        jobs: [
          job({
            extracted: false,
            bead_list: '',
            md_table: '',
            note: '这几张图里没有找到色号统计区域，换一张底部带色号列表的图试试。',
          }),
        ],
        // 后端不把它算进未读——「没抽到」不值得亮红点
        unseen: 0,
        running: 0,
      },
    },
  };

  test('shows the model’s explanation instead of a bogus success', async () => {
    mockFetch(noExtraction);
    renderDialog();
    expect(await screen.findByText(/没有找到色号统计区域/)).toBeInTheDocument();
  });

  test('offers neither 填入清单 nor 明细, since there is nothing to fill or show', async () => {
    mockFetch(noExtraction);
    renderDialog();
    await screen.findByText(/没有找到色号统计区域/);
    expect(screen.queryByRole('button', { name: '填入清单' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看各图明细' })).not.toBeInTheDocument();
    // 但还是能删掉这条记录
    expect(screen.getByRole('button', { name: '删除这条记录' })).toBeInTheDocument();
  });

  test('no red dot for it', async () => {
    mockFetch(noExtraction);
    renderPage();
    await screen.findByRole('button', { name: /按图扣减/ });
    await waitFor(() => expect(screen.queryByLabelText(/识别结果待查看/)).not.toBeInTheDocument());
  });
});



describe('认不出来的那张图', () => {
  const withFailure = {
    ...base,
    'GET /api/auth/me': vipMe,
    'GET /api/patterns': {
      body: {
        jobs: [
          job({
            error: '1/2 张未能识别',
            md_table:
              '| 色号 | 图片1 | 图片2 | 合计 |\n| --- | --- | --- | --- |\n' +
              '| A3 | 105 |  | 105 |\n| 色号数量 | 1 | 0 | 1 |\n| 总豆数 | 105 | 0 | 105 |',
            items: [
              { index: 0, image_index: 0, filename: 'ok.png', status: 'ok', error: '', notes: [] },
              {
                index: 1,
                image_index: 1,
                filename: 'bad.png',
                status: 'failed',
                error: '识别失败',
                notes: [],
              },
            ],
          }),
        ],
        unseen: 1,
        running: 0,
      },
    },
  };

  test('它的列还在，还能点开原图，只是整列标红', async () => {
    mockFetch(withFailure);
    renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: '查看各图明细' }));

    // 列没有被藏掉：藏了的话后面每一列的"图片N"都会悄悄错位
    const bad = await screen.findByRole('button', { name: /图片2/ });
    expect(bad.closest('th')).toHaveClass('failed-col');
    // 整列——表头和每一个单元格
    const table = screen.getByRole('table', { name: '各图色号明细' });
    const marked = table.querySelectorAll('td.failed-col');
    expect(marked.length).toBeGreaterThan(0);

    // 照样点得开：用户第一件想做的事就是亲眼看看它怎么了
    await userEvent.click(bad);
    expect(await screen.findByAltText('识别用的第 2 张图')).toBeInTheDocument();
  });

  test('失败原因单独列出来，而不是只有一句 N/M', async () => {
    mockFetch(withFailure);
    renderDialog();
    await userEvent.click(await screen.findByRole('button', { name: '查看各图明细' }));
    expect(await screen.findByText(/bad\.png/)).toBeInTheDocument();
  });
});
