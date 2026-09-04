import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from './App';
import { AuthProvider } from './state/AuthContext';
import { ToastProvider } from './state/ToastContext';
import { mockFetch, renderWithProviders } from './test/utils';

const setup = () =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>,
  );

describe('App auth gate', () => {
  test('shows the login form when unauthenticated', async () => {
    mockFetch({ 'GET /api/auth/me': { status: 401, body: { detail: 'not authenticated' } } });
    setup();
    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  test('shows the app for a signed-in user', async () => {
    mockFetch({
      'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
      'GET /api/colors': { body: [] },
      'GET /api/inventory': { body: [] },
      'GET /api/operations': { body: [] },
    });
    setup();
    expect(await screen.findByRole('heading', { name: '拼豆助手' })).toBeInTheDocument();
    expect(await screen.findByText('amy')).toBeInTheDocument();
  });
});

describe('导航', () => {
  test('「图纸」插在「配色」和「我的色卡」之间', async () => {
    mockFetch({
      'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
      'GET /api/colors': { body: [] },
      'GET /api/inventory': { body: [] },
      'GET /api/operations': { body: [] },
      'GET /api/inventory/stockout': { body: { rows: [] } },
    });
    setup();
    await screen.findByRole('link', { name: /图纸/ });
    const labels = screen.getAllByRole('link').map((a) => a.textContent?.trim());
    const i = labels.indexOf('配色');
    expect(labels[i + 1]).toBe('图纸');
    expect(labels[i + 2]).toBe('我的色卡');
  });
});
