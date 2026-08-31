import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import AppShell from './AppShell';

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
        <AppShell />
      </ToastProvider>
    </AuthProvider>,
  );

describe('AppShell', () => {
  test('shows the user and the navigation', async () => {
    mockFetch(base);
    setup();
    expect(await screen.findByText('amy')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '库存' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '历史' })).toBeInTheDocument();
  });

  test('saves a new threshold', async () => {
    mockFetch({ ...base, 'PATCH /api/settings': { body: { threshold: 250 } } });
    setup();
    const input = await screen.findByLabelText('低库存阈值');
    await waitFor(() => expect(input).toHaveValue('500')); // wait for /auth/me
    await userEvent.clear(input);
    await userEvent.type(input, '250');
    await userEvent.click(screen.getByRole('button', { name: '保存阈值' }));
    await waitFor(() => expect(lastRequest('PATCH', '/api/settings')).toBeDefined());
    expect(JSON.parse(String(lastRequest('PATCH', '/api/settings')!.init!.body))).toEqual({
      threshold: 250,
    });
  });

  test('logs out', async () => {
    mockFetch({ ...base, 'POST /api/auth/logout': { status: 204 } });
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '退出' }));
    await waitFor(() => expect(lastRequest('POST', '/api/auth/logout')).toBeDefined());
  });
});
