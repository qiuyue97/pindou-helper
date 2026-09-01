import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import CheckDialog from './CheckDialog';

const base = {
  'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
  'GET /api/colors': { body: [] },
  'GET /api/inventory': { body: [] },
  'GET /api/operations': { body: [] },
  'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
};

describe('CheckDialog', () => {
  test('reports enough / short / unknown per line', async () => {
    mockFetch({
      ...base,
      'POST /api/inventory/check': {
        body: {
          results: [
            { line: 1, code: 'A1', need: 60, have: 100, status: 'enough' },
            { line: 2, code: 'A1', need: 150, have: 100, status: 'short' },
            { line: 3, code: 'ZZZ9', need: 1, have: null, status: 'unknown_code' },
          ],
        },
      },
    });
    renderWithProviders(
      <AuthProvider>
        <ToastProvider>
          <CheckDialog onClose={vi.fn()} />
        </ToastProvider>
      </AuthProvider>,
    );
    await userEvent.type(screen.getByLabelText('需求清单'), 'A1,60\nA1,150\nZZZ9,1');
    await userEvent.click(screen.getByRole('button', { name: '核对' }));

    const table = await screen.findByRole('table', { name: '核对结果' });
    const rows = within(table).getAllByRole('row').slice(1);
    // 缺口排最上面，其次是有问题的行，够用的沉到最后——核对就是为了找缺口，
    // 不能让它被一堆「足够」淹掉。输入顺序是 enough / short / unknown。
    expect(rows[0]).toHaveTextContent('还差 50（现有 100）');
    expect(rows[1]).toHaveTextContent('色号不存在');
    expect(rows[2]).toHaveTextContent('足够（现有 100）');
  });

  test('drops the row-number column', async () => {
    mockFetch({
      ...base,
      'POST /api/inventory/check': {
        body: { results: [{ line: 1, code: 'A1', need: 60, have: 100, status: 'enough' }] },
      },
    });
    renderWithProviders(
      <AuthProvider>
        <ToastProvider>
          <CheckDialog onClose={vi.fn()} />
        </ToastProvider>
      </AuthProvider>,
    );
    await userEvent.type(screen.getByLabelText('需求清单'), 'A1,60');
    await userEvent.click(screen.getByRole('button', { name: '核对' }));

    const table = await screen.findByRole('table', { name: '核对结果' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['色号', '需求', '结果']);
  });

  const vipBase = {
    ...base,
    'GET /api/auth/me': { body: { username: 'amy', threshold: 500, is_vip: true } },
  };

  const okResults = {
    'POST /api/inventory/check': {
      body: {
        results: [
          { line: 1, code: 'A1', need: 60, have: 100, status: 'enough' },
          { line: 2, code: 'A2', need: 150, have: 100, status: 'short' },
        ],
      },
    },
  };

  const renderDialog = (onClose = vi.fn()) =>
    renderWithProviders(
      <AuthProvider>
        <ToastProvider>
          <CheckDialog onClose={onClose} />
        </ToastProvider>
      </AuthProvider>,
    );

  const runCheck = async () => {
    await userEvent.type(screen.getByLabelText('需求清单'), 'A1,60\nA2,150');
    await userEvent.click(screen.getByRole('button', { name: '核对' }));
    await screen.findByRole('table', { name: '核对结果' });
  };

  describe('应用扣减', () => {
    test('is disabled until a check has run', async () => {
      mockFetch({ ...base, ...okResults });
      renderDialog();
      expect(screen.getByRole('button', { name: '应用扣减' })).toBeDisabled();
      await runCheck();
      expect(screen.getByRole('button', { name: '应用扣减' })).toBeEnabled();
    });

    test('deducts the checked demand and closes', async () => {
      mockFetch({
        ...base,
        ...okResults,
        'POST /api/inventory/batch': {
          body: {
            ok: true,
            applied: true,
            results: [],
            changes: [{ code: 'A1', from: 100, to: 40 }],
          },
        },
      });
      const onClose = vi.fn();
      renderDialog(onClose);
      await runCheck();
      await userEvent.click(screen.getByRole('button', { name: '应用扣减' }));

      await waitFor(() => expect(lastRequest('POST', '/api/inventory/batch')).toBeDefined());
      expect(JSON.parse(String(lastRequest('POST', '/api/inventory/batch')!.init!.body))).toEqual({
        mode: 'deduct',
        text: 'A1,60\nA2,150',
      });
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    test('a short line still deducts, because negatives are allowed on purpose', async () => {
      mockFetch({ ...base, ...okResults });
      renderDialog();
      await runCheck();
      // Line 2 is short by 50; the inventory is meant to be able to go negative.
      expect(screen.getByRole('button', { name: '应用扣减' })).toBeEnabled();
    });

    test('an invalid line blocks the deduction', async () => {
      mockFetch({
        ...base,
        'POST /api/inventory/check': {
          body: {
            results: [
              { line: 1, code: 'A1', need: 60, have: 100, status: 'enough' },
              { line: 2, code: 'ZZZ9', need: 1, have: null, status: 'unknown_code' },
            ],
          },
        },
      });
      renderDialog();
      await userEvent.type(screen.getByLabelText('需求清单'), 'A1,60\nZZZ9,1');
      await userEvent.click(screen.getByRole('button', { name: '核对' }));
      await screen.findByRole('table', { name: '核对结果' });
      expect(screen.getByRole('button', { name: '应用扣减' })).toBeDisabled();
    });

    test('editing the demand invalidates the stale results', async () => {
      mockFetch({ ...base, ...okResults });
      renderDialog();
      await runCheck();
      await userEvent.type(screen.getByLabelText('需求清单'), '\nA3,5');
      // Applying results that describe different text would deduct the wrong amounts.
      expect(screen.queryByRole('table', { name: '核对结果' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '应用扣减' })).toBeDisabled();
    });
  });

  describe('VIP 拼豆图纸AI抽取', () => {
    test('a normal account sees the feature but gets the upsell', async () => {
      mockFetch(base);
      renderDialog();
      // Visible rather than hidden — that is the whole point of showing it.
      expect(await screen.findByText('拼豆图纸AI抽取')).toBeInTheDocument();
      expect(screen.queryByLabelText('上传图片')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /上传拼豆图纸/ }));
      expect(await screen.findByRole('status')).toHaveTextContent('请升级VIP获取服务');
    });

    test('a VIP account gets the real uploader, capped at 10', async () => {
      mockFetch(vipBase);
      renderDialog();
      const input = await screen.findByLabelText('上传图片');
      expect(input).toHaveAttribute('multiple');
      expect(input).toHaveAttribute('accept', 'image/*');

      const files = Array.from(
        { length: 11 },
        (_, i) => new File(['x'], `p${i}.png`, { type: 'image/png' }),
      );
      await userEvent.upload(input, files);
      const grid = await screen.findByRole('list', { name: '已选图片' });
      expect(within(grid).getAllByRole('listitem')).toHaveLength(10);
      expect(await screen.findByRole('status')).toHaveTextContent('最多上传 10 张');
    });

    test('a picked image can be removed again', async () => {
      mockFetch(vipBase);
      renderDialog();
      const input = await screen.findByLabelText('上传图片');
      await userEvent.upload(input, [new File(['x'], 'one.png', { type: 'image/png' })]);
      const grid = await screen.findByRole('list', { name: '已选图片' });
      expect(within(grid).getAllByRole('listitem')).toHaveLength(1);
      await userEvent.click(screen.getByRole('button', { name: '移除 one.png' }));
      expect(screen.queryByRole('list', { name: '已选图片' })).not.toBeInTheDocument();
    });
  });
});
