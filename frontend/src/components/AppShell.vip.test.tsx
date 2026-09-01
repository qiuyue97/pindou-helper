import { screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { mockFetch, renderWithProviders } from '../test/utils';
import AppShell from './AppShell';

const base = {
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

describe('the header marks a VIP account', () => {
  test('a VIP account gets the badge in front of the username', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': { body: { username: 'amy', threshold: 500, is_vip: true } },
    });
    setup();
    const name = await screen.findByText('amy');
    const right = name.parentElement!;
    expect(within(right).getByTitle('VIP 功能')).toBeInTheDocument();
  });

  test('a normal account gets no badge', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
    });
    setup();
    const name = await screen.findByText('amy');
    expect(within(name.parentElement!).queryByTitle('VIP 功能')).not.toBeInTheDocument();
  });
});
