import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import AddCodeDialog from './AddCodeDialog';

const base = {
  'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
  'GET /api/colors': { body: [] },
  'GET /api/inventory': { body: [] },
  'GET /api/operations': { body: [] },
  'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
};

const setup = (onClose = vi.fn()) => {
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <AddCodeDialog onClose={onClose} />
      </ToastProvider>
    </AuthProvider>,
  );
  return onClose;
};

describe('AddCodeDialog', () => {
  test('adds a known code with an initial quantity', async () => {
    mockFetch({
      ...base,
      'PUT /api/inventory/B12': { body: { changes: [{ code: 'B12', from: null, to: 300 }] } },
    });
    const onClose = setup();
    await userEvent.type(screen.getByLabelText('色号'), 'b12');
    const qty = screen.getByLabelText('初始数量');
    await userEvent.clear(qty);
    await userEvent.type(qty, '300');
    await userEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => expect(lastRequest('PUT', '/api/inventory/B12')).toBeDefined());
    expect(JSON.parse(String(lastRequest('PUT', '/api/inventory/B12')!.init!.body))).toEqual({
      quantity: 300,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('rejects an unknown code without calling the API', async () => {
    mockFetch(base);
    setup();
    await userEvent.type(screen.getByLabelText('色号'), 'ZZZ9');
    await userEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("色号 'ZZZ9' 不存在");
    expect(lastRequest('PUT', '/api/inventory/ZZZ9')).toBeUndefined();
  });
});
