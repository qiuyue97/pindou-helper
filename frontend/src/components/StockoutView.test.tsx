import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { mockFetch, renderWithProviders } from '../test/utils';
import StockoutView from './StockoutView';

const base = {
  'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
  'GET /api/colors': { body: [] },
  'GET /api/inventory': { body: [] },
  'GET /api/operations': { body: [] },
};

const setup = () =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <StockoutView />
      </ToastProvider>
    </AuthProvider>,
  );

describe('StockoutView', () => {
  test('lists shortages with tiers and a copyable code list', async () => {
    mockFetch({
      ...base,
      'GET /api/inventory/stockout': {
        body: {
          codes: ['A2', 'A3'],
          text: 'A2,A3',
          items: [
            { code: 'A2', quantity: -50 },
            { code: 'A3', quantity: 40 },
          ],
        },
      },
    });
    setup();
    expect(await screen.findByText('-50')).toHaveAttribute('data-tier', 'negative');
    expect(screen.getByText('40')).toHaveAttribute('data-tier', 'low');
    expect(screen.getByLabelText('缺货色号')).toHaveValue('A2,A3');
  });

  test('shows the all-stocked message', async () => {
    mockFetch({
      ...base,
      'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
    });
    setup();
    expect(await screen.findByText('所有库存都充足，无缺货项！')).toBeInTheDocument();
  });
});
