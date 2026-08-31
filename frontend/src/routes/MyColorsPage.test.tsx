import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { ToastProvider } from '../state/ToastContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import MyColorsPage from './MyColorsPage';

const base = {
  'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } },
  'GET /api/inventory': { body: [] },
  'GET /api/operations': { body: [] },
  'GET /api/inventory/stockout': { body: { codes: [], text: '', items: [] } },
  'GET /api/colors': {
    body: [
      { code: 'C7', hex: '9D5B3E', source: 'override', base_hex: '3677D2' },
      { code: 'X1', hex: 'A03D2F', source: 'custom', base_hex: null },
    ],
  },
};

const setup = () =>
  renderWithProviders(
    <AuthProvider>
      <ToastProvider>
        <MyColorsPage />
      </ToastProvider>
    </AuthProvider>,
  );

const rowFor = async (code: string) => (await screen.findByText(code)).closest('tr')!;

describe('MyColorsPage', () => {
  test('labels standard, overridden and custom colours', async () => {
    mockFetch(base);
    setup();
    await userEvent.type(await screen.findByLabelText('搜索色号'), 'C7');
    expect(within(await rowFor('C7')).getByText('已改')).toBeInTheDocument();
    expect(within(await rowFor('C7')).getByText('默认 #3677D2')).toBeInTheDocument();
  });

  test('reverts an override', async () => {
    mockFetch({ ...base, 'DELETE /api/colors/C7': { status: 204 } });
    setup();
    await userEvent.type(await screen.findByLabelText('搜索色号'), 'C7');
    await userEvent.click(within(await rowFor('C7')).getByRole('button', { name: '恢复默认' }));
    await waitFor(() => expect(lastRequest('DELETE', '/api/colors/C7')).toBeDefined());
  });

  test('refuses to delete a referenced custom colour and surfaces the reason', async () => {
    mockFetch({
      ...base,
      'DELETE /api/colors/X1': {
        status: 409,
        body: { detail: 'colour is still used by inventory or history' },
      },
    });
    setup();
    await userEvent.type(await screen.findByLabelText('搜索色号'), 'X1');
    await userEvent.click(within(await rowFor('X1')).getByRole('button', { name: '删除' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'colour is still used by inventory or history',
    );
  });

  test('saves a new hex for a standard colour', async () => {
    mockFetch({
      ...base,
      'PUT /api/colors/A1': {
        body: { code: 'A1', hex: '112233', source: 'override', base_hex: 'FAF4C8' },
      },
    });
    setup();
    await userEvent.type(await screen.findByLabelText('搜索色号'), 'A1');
    await userEvent.click(within(await rowFor('A1')).getByRole('button', { name: '修改HEX' }));

    const hexField = await screen.findByLabelText('十六进制');
    await userEvent.clear(hexField);
    await userEvent.type(hexField, '#112233');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(lastRequest('PUT', '/api/colors/A1')).toBeDefined());
    expect(JSON.parse(String(lastRequest('PUT', '/api/colors/A1')!.init!.body))).toEqual({
      hex: '112233',
    });
  });
});
