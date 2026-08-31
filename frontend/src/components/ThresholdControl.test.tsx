import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import ThresholdControl from './ThresholdControl';

const base = {
  'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
  'GET /api/colors': { body: [] },
  'GET /api/inventory': { body: [] },
  'GET /api/operations': { body: [] },
  'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
};

const setup = () =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <ThresholdControl />
      </ToastProvider>
    </AuthProvider>,
  );

describe('ThresholdControl', () => {
  test('saves a new threshold', async () => {
    mockFetch({ ...base, 'PATCH /api/settings': { body: { threshold: 250 } } });
    setup();
    const input = await screen.findByLabelText('低库存阈值');
    await waitFor(() => expect(input).toHaveValue('500'));
    await userEvent.clear(input);
    await userEvent.type(input, '250');
    await userEvent.click(screen.getByRole('button', { name: '保存阈值' }));
    await waitFor(() => expect(lastRequest('PATCH', '/api/settings')).toBeDefined());
    expect(JSON.parse(String(lastRequest('PATCH', '/api/settings')!.init!.body))).toEqual({
      threshold: 250,
    });
  });

  test('rejects a non-integer without calling the API', async () => {
    mockFetch(base);
    setup();
    const input = await screen.findByLabelText('低库存阈值');
    await waitFor(() => expect(input).toHaveValue('500'));
    await userEvent.clear(input);
    await userEvent.type(input, 'abc');
    await userEvent.click(screen.getByRole('button', { name: '保存阈值' }));
    expect(await screen.findByRole('status')).toHaveTextContent('阈值应为不小于 0 的整数');
    expect(lastRequest('PATCH', '/api/settings')).toBeUndefined();
  });
});
