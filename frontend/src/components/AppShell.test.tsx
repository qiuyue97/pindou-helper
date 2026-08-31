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

  test('does not carry the low-stock threshold — that belongs to the inventory tab', async () => {
    mockFetch(base);
    setup();
    await screen.findByText('amy');
    expect(screen.queryByLabelText('低库存阈值')).not.toBeInTheDocument();
  });

  test('logs out', async () => {
    mockFetch({ ...base, 'POST /api/auth/logout': { status: 204 } });
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '退出' }));
    await waitFor(() => expect(lastRequest('POST', '/api/auth/logout')).toBeDefined());
  });
});
