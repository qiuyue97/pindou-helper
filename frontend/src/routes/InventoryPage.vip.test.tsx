import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { mockFetch, renderWithProviders } from '../test/utils';
import InventoryPage from './InventoryPage';

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
        <InventoryPage />
      </ToastProvider>
    </AuthProvider>,
  );

describe('智能管控 (VIP)', () => {
  test('replaced the old 添加色号 button', async () => {
    mockFetch({ ...base, 'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } } });
    setup();
    expect(await screen.findByRole('button', { name: /智能管控/ })).toBeInTheDocument();
    // The old button only duplicated editing a quantity in the table below.
    expect(screen.queryByRole('button', { name: '添加色号' })).not.toBeInTheDocument();
  });

  test('a normal account can see and click it, but gets the upsell', async () => {
    mockFetch({ ...base, 'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } } });
    setup();
    const btn = await screen.findByRole('button', { name: /智能管控/ });
    // Deliberately NOT disabled: clicking is how the user learns it is a paid feature.
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(await screen.findByRole('status')).toHaveTextContent('请升级VIP获取服务');
    expect(screen.queryByLabelText('自然语言输入')).not.toBeInTheDocument();
  });

  test('a VIP account opens the dialog', async () => {
    mockFetch({
      ...base,
      'GET /api/auth/me': { body: { username: 'amy', threshold: 500, is_vip: true } },
    });
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /智能管控/ }));
    expect(await screen.findByLabelText('自然语言输入')).toBeInTheDocument();
  });

  test('the VIP marking is present for both tiers', async () => {
    mockFetch({ ...base, 'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } } });
    const { unmount } = setup();
    expect((await screen.findByRole('button', { name: /智能管控/ })).textContent).toContain('VIP');
    unmount();

    mockFetch({
      ...base,
      'GET /api/auth/me': { body: { username: 'amy', threshold: 500, is_vip: true } },
    });
    setup();
    expect((await screen.findByRole('button', { name: /智能管控/ })).textContent).toContain('VIP');
  });
});
