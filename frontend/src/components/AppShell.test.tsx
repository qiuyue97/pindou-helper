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

describe('AppShell greeting', () => {
  // The hour -> phrase mapping is covered exhaustively in lib/greeting.test.ts;
  // here we only care that the shell renders it in front of the username.
  test('greets the user before their name', async () => {
    mockFetch(base);
    setup();
    // the greeting renders before /auth/me resolves, so wait on the name
    expect(await screen.findByText('amy')).toBeInTheDocument();
    expect(screen.getByText(/^(凌晨|早上|中午|晚上)好，$/)).toBeInTheDocument();
  });
});
