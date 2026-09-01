import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import BatchDialog from './BatchDialog';

const base = {
  'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
  'GET /api/colors': { body: [] },
  'GET /api/inventory': { body: [{ code: 'A1', quantity: 100, updated_at: '2026-08-31T10:00:00Z' }] },
  'GET /api/operations': { body: [] },
  'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
};

const setup = (props: Partial<Parameters<typeof BatchDialog>[0]> = {}) =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <BatchDialog mode="add" scopeSet="291" onClose={vi.fn()} {...props} />
      </ToastProvider>
    </AuthProvider>,
  );

describe('BatchDialog', () => {
  test('previews parsed lines live, tolerating Chinese commas', async () => {
    mockFetch(base);
    setup();
    await userEvent.type(screen.getByLabelText('批量输入'), 'A1，20\nA2 5');
    const preview = await screen.findByRole('table', { name: '解析预览' });
    const rows = within(preview).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('A1');
    expect(rows[0]).toHaveTextContent('20');
    expect(within(preview).getAllByText('正常')).toHaveLength(2);
  });

  test('disables 应用 while any line is invalid', async () => {
    mockFetch(base);
    setup();
    const ta = screen.getByLabelText('批量输入');
    await userEvent.type(ta, 'A1,10\nZZZ9,5');
    expect(await screen.findByText('色号不存在')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();

    await userEvent.clear(ta);
    await userEvent.type(ta, 'A1,10');
    await waitFor(() => expect(screen.getByRole('button', { name: '应用' })).toBeEnabled());
  });

  test('applies and toasts the resulting diff', async () => {
    mockFetch({
      ...base,
      'POST /api/inventory/batch': {
        body: {
          ok: true,
          applied: true,
          results: [],
          changes: [{ code: 'A1', from: 100, to: 120 }],
        },
      },
    });
    const onClose = vi.fn();
    setup({ onClose });
    await userEvent.type(screen.getByLabelText('批量输入'), 'A1,20');
    await userEvent.click(await screen.findByRole('button', { name: '应用' }));

    await waitFor(() => expect(lastRequest('POST', '/api/inventory/batch')).toBeDefined());
    expect(JSON.parse(String(lastRequest('POST', '/api/inventory/batch')!.init!.body))).toEqual({
      mode: 'add',
      text: 'A1,20',
      scope: { set: '291', include_custom: true },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('A1 100→120');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('warns that a deduction would go negative but still allows it', async () => {
    mockFetch(base);
    setup({ mode: 'deduct' });
    await userEvent.type(screen.getByLabelText('批量输入'), 'A1,250');
    expect(await screen.findByText('将扣成负数')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled();
  });

  test('clicking a preview row selects that line in the textarea', async () => {
    mockFetch(base);
    setup();
    const ta = screen.getByLabelText('批量输入') as HTMLTextAreaElement;
    await userEvent.type(ta, 'A1,10\nA1,20');
    const preview = await screen.findByRole('table', { name: '解析预览' });
    await userEvent.click(within(preview).getAllByRole('row')[2]!);
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('A1,20');
  });
});

describe('BatchDialog · ALL wildcard', () => {
  test('previews ALL as one row expanded over the scope, not an unknown code', async () => {
    mockFetch(base);
    setup({ scopeSet: '221' });
    await userEvent.type(screen.getByLabelText('批量输入'), 'ALL,100');
    const preview = await screen.findByRole('table', { name: '解析预览' });
    const rows = within(preview).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('ALL');
    expect(rows[0]).toHaveTextContent('221 个色号');
    expect(within(preview).queryByText('色号不存在')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled();
  });

  test('sends the scope alongside the text', async () => {
    mockFetch({
      ...base,
      'POST /api/inventory/batch': {
        body: { ok: true, applied: true, results: [], changes: [{ code: 'A1', from: 100, to: 200 }] },
      },
    });
    setup({ scopeSet: '221' });
    await userEvent.type(screen.getByLabelText('批量输入'), 'ALL,100');
    await userEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(lastRequest('POST', '/api/inventory/batch')).toBeDefined());
    expect(JSON.parse(String(lastRequest('POST', '/api/inventory/batch')!.init!.body))).toEqual({
      mode: 'add',
      text: 'ALL,100',
      scope: { set: '221', include_custom: true },
    });
  });

  test('documents the wildcard in the dialog', () => {
    mockFetch(base);
    setup({});
    expect(screen.getByText(/ALL,100/)).toBeInTheDocument();
  });

  test('a series wildcard previews the number of codes it covers', async () => {
    mockFetch(base);
    setup({ scopeSet: '291' });
    await userEvent.type(screen.getByLabelText('批量输入'), 'A*,1000');
    const preview = await screen.findByRole('table', { name: '解析预览' });
    const row = within(preview).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('A*');
    // The A series has 26 colours; the row must say so rather than list them.
    expect(row).toHaveTextContent('26 个色号');
  });

  test('a lowercase wildcard is accepted just like the uppercase one', async () => {
    mockFetch(base);
    setup({ scopeSet: '291' });
    await userEvent.type(screen.getByLabelText('批量输入'), 'a*,5\nall,1');
    const preview = await screen.findByRole('table', { name: '解析预览' });
    const rows = within(preview).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('26 个色号');
    expect(rows[1]).toHaveTextContent('291 个色号');
    expect(screen.getByRole('button', { name: '应用' })).toBeEnabled();
  });

  test('a series nothing matches is rejected instead of applying as a no-op', async () => {
    mockFetch(base);
    setup({ scopeSet: '291' });
    await userEvent.type(screen.getByLabelText('批量输入'), 'X*,5');
    const preview = await screen.findByRole('table', { name: '解析预览' });
    expect(within(preview).getAllByRole('row')[1]!).toHaveTextContent('当前范围内没有这个系列');
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
  });

  test('a special series is empty under 221 but covered under 291', async () => {
    mockFetch(base);
    const { unmount } = setup({ scopeSet: '221' });
    await userEvent.type(screen.getByLabelText('批量输入'), 'ZG*,4');
    expect(screen.getByRole('button', { name: '应用' })).toBeDisabled();
    unmount();

    setup({ scopeSet: '291' });
    await userEvent.type(screen.getByLabelText('批量输入'), 'ZG*,4');
    expect(await screen.findByRole('button', { name: '应用' })).toBeEnabled();
  });
});
