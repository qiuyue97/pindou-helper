import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import InventoryTable from './InventoryTable';

const rows = [
  { code: 'A1', quantity: 900, updated_at: '2026-08-31T10:00:00Z' },
  { code: 'A2', quantity: 120, updated_at: '2026-08-31T10:00:00Z' },
  { code: 'A3', quantity: -15, updated_at: '2026-08-31T10:00:00Z' },
];

const base = {
  'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
  'GET /api/colors': { body: [] },
  'GET /api/inventory': { body: rows },
  'GET /api/operations': { body: [] },
  'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
};

const setup = () =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <InventoryTable />
      </ToastProvider>
    </AuthProvider>,
  );

describe('InventoryTable', () => {
  test('marks each quantity with its tier', async () => {
    mockFetch(base);
    setup();
    await waitFor(() => expect(screen.getByText('900')).toHaveAttribute('data-tier', 'ok'));
    expect(screen.getByText('120')).toHaveAttribute('data-tier', 'low');
    expect(screen.getByText('-15')).toHaveAttribute('data-tier', 'negative');
  });

  test('inline edit commits with PUT and toasts the diff', async () => {
    mockFetch({
      ...base,
      'PUT /api/inventory/A2': { body: { changes: [{ code: 'A2', from: 120, to: 640 }] } },
    });
    setup();
    await userEvent.click(await screen.findByText('120'));
    const input = screen.getByLabelText('A2 数量');
    await userEvent.clear(input);
    await userEvent.type(input, '640{Enter}');

    await waitFor(() => expect(lastRequest('PUT', '/api/inventory/A2')).toBeDefined());
    expect(JSON.parse(String(lastRequest('PUT', '/api/inventory/A2')!.init!.body))).toEqual({
      quantity: 640,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('A2 120→640');
  });

  test('Escape cancels an inline edit without calling the API', async () => {
    mockFetch(base);
    setup();
    await userEvent.click(await screen.findByText('120'));
    await userEvent.type(screen.getByLabelText('A2 数量'), '999{Escape}');
    expect(lastRequest('PUT', '/api/inventory/A2')).toBeUndefined();
    expect(screen.getByText('120')).toBeInTheDocument();
  });

  test('deletes a row', async () => {
    mockFetch({
      ...base,
      'DELETE /api/inventory/A3': { body: { changes: [{ code: 'A3', from: -15, to: null }] } },
    });
    setup();
    const row = (await screen.findByText('A3')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(lastRequest('DELETE', '/api/inventory/A3')).toBeDefined());
  });

  test('shows an empty state', async () => {
    mockFetch({ ...base, 'GET /api/inventory': { body: [] } });
    setup();
    expect(await screen.findByText('还没有库存记录，先添加色号或批量补货。')).toBeInTheDocument();
  });
});
