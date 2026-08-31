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
        <BatchDialog mode="add" onClose={vi.fn()} {...props} />
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
