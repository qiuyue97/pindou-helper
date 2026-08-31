import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { mockFetch, renderWithProviders } from '../test/utils';
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
    expect(rows[0]).toHaveTextContent('足够（现有 100）');
    expect(rows[1]).toHaveTextContent('还差 50（现有 100）');
    expect(rows[2]).toHaveTextContent('色号不存在');
  });
});
