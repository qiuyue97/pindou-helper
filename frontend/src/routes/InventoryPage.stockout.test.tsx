import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import ThresholdControl from '../components/ThresholdControl';
import StockoutView from '../components/StockoutView';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { mockFetch, renderWithProviders } from '../test/utils';

describe('changing the threshold refreshes the stockout list', () => {
  test('the server-computed list updates without a page reload', async () => {
    let threshold = 500;
    let stockoutCalls = 0;

    mockFetch({
      'GET /api/auth/me': () => ({ body: { username: 'amy', threshold } }),
      'GET /api/colors': { body: [] },
      'GET /api/inventory': { body: [] },
      'GET /api/operations': { body: [] },
      'PATCH /api/settings': () => {
        threshold = 1200;
        return { body: { threshold } };
      },
      // The backend decides what counts as low, using the saved threshold.
      'GET /api/inventory/stockout': () => {
        stockoutCalls += 1;
        return threshold >= 1200
          ? { body: { codes: ['A1'], text: 'A1', items: [{ code: 'A1', quantity: 900 }] } }
          : { body: { codes: [], text: '', items: [] } };
      },
    });

    renderWithProviders(
      <AuthProvider>
        <ToastProvider>
          <ThresholdControl />
          <StockoutView />
        </ToastProvider>
      </AuthProvider>,
    );

    expect(await screen.findByText('所有库存都充足，无缺货项！')).toBeInTheDocument();
    const before = stockoutCalls;

    const input = await screen.findByLabelText('低库存阈值');
    await waitFor(() => expect(input).toHaveValue('500'));
    await userEvent.clear(input);
    await userEvent.type(input, '1200');
    await userEvent.click(screen.getByRole('button', { name: '保存阈值' }));

    // A1 at 900 is now below the threshold, so the list must pick it up.
    expect(await screen.findByLabelText('缺货色号')).toHaveValue('A1');
    expect(await screen.findByText('900')).toHaveAttribute('data-tier', 'low');
    expect(stockoutCalls).toBeGreaterThan(before);
  });
});
