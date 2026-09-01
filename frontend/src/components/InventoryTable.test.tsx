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

const setup = (scopeSet: '221' | '291' = '221') =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <InventoryTable scopeSet={scopeSet} />
      </ToastProvider>
    </AuthProvider>,
  );

const cellFor = async (code: string) =>
  (await screen.findByTestId(`cell-${code}`)) as HTMLElement;

describe('InventoryTable', () => {
  test('shows every catalogue code, including ones with no inventory row', async () => {
    mockFetch(base);
    setup('221');
    // A4 has no inventory row at all — it must still appear, at 0
    const a4 = await cellFor('A4');
    expect(within(a4).getByText('A4')).toBeInTheDocument();
    expect(within(a4).getByText('0')).toBeInTheDocument();
  });

  test('keeps the three quantity tiers', async () => {
    mockFetch(base);
    setup('221');
    expect(within(await cellFor('A1')).getByText('900')).toHaveAttribute('data-tier', 'ok');
    expect(within(await cellFor('A2')).getByText('120')).toHaveAttribute('data-tier', 'low');
    expect(within(await cellFor('A3')).getByText('-15')).toHaveAttribute('data-tier', 'negative');
    // a code with no row reads as 0, which is below the threshold
    expect(within(await cellFor('A4')).getByText('0')).toHaveAttribute('data-tier', 'low');
  });

  test('drops the 系列 / 更新时间 / 删除 columns', async () => {
    mockFetch(base);
    setup('221');
    await cellFor('A1');
    expect(screen.queryByText('更新时间')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  });

  test('writes the code inside the colour block', async () => {
    mockFetch(base);
    setup('221');
    const swatch = within(await cellFor('A1')).getByTestId('block-A1');
    expect(swatch).toHaveTextContent('A1');
  });

  test('221 lays out one column per A–M series and excludes special colours', async () => {
    mockFetch(base);
    setup('221');
    const cols = await screen.findAllByRole('group');
    expect(cols.map((c) => c.getAttribute('data-series'))).toEqual([
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M',
    ]);
    expect(screen.queryByTestId('cell-T1')).not.toBeInTheDocument();
  });

  test('291 adds a second section for the special series', async () => {
    mockFetch(base);
    setup('291');
    expect(await screen.findByTestId('cell-T1')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '标准色 A–M' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '特殊色' })).toBeInTheDocument();
  });

  test('inline edit still commits with PUT and toasts the diff', async () => {
    mockFetch({
      ...base,
      'PUT /api/inventory/A2': { body: { changes: [{ code: 'A2', from: 120, to: 640 }] } },
    });
    setup('221');
    await userEvent.click(within(await cellFor('A2')).getByText('120'));
    const input = screen.getByLabelText('A2 数量');
    await userEvent.clear(input);
    await userEvent.type(input, '640{Enter}');

    await waitFor(() => expect(lastRequest('PUT', '/api/inventory/A2')).toBeDefined());
    expect(JSON.parse(String(lastRequest('PUT', '/api/inventory/A2')!.init!.body))).toEqual({
      quantity: 640,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('A2 120→640');
  });

  test('editing a code that had no row creates it', async () => {
    mockFetch({
      ...base,
      'PUT /api/inventory/A4': { body: { changes: [{ code: 'A4', from: null, to: 50 }] } },
    });
    setup('221');
    await userEvent.click(within(await cellFor('A4')).getByText('0'));
    const input = screen.getByLabelText('A4 数量');
    await userEvent.clear(input);
    await userEvent.type(input, '50{Enter}');
    await waitFor(() => expect(lastRequest('PUT', '/api/inventory/A4')).toBeDefined());
  });

  test('the quantity editor carries size=1 so opening it cannot widen the cell', async () => {
    // The inventory columns are max-content sized. An <input> without `size`
    // reports an intrinsic width of ~20 characters, which used to stretch the
    // cell — and its colour block — from 92px to 251px the moment a quantity
    // was clicked. jsdom does no layout, so the attribute is what we assert:
    // it is the entire fix, and dropping it silently brings the jump back.
    mockFetch(base);
    setup();
    const cell = await screen.findByTestId('cell-A2');
    await userEvent.click(within(cell).getByRole('button'));
    expect(await screen.findByLabelText('A2 数量')).toHaveAttribute('size', '1');
  });
});
