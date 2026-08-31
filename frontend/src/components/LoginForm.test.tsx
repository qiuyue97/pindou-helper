import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { AuthProvider } from '../state/AuthContext';
import { lastRequest, mockFetch, renderWithProviders } from '../test/utils';
import LoginForm from './LoginForm';

const setup = () =>
  renderWithProviders(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  );

describe('LoginForm', () => {
  test('logs in and posts the credentials', async () => {
    mockFetch({
      'GET /api/auth/me': { status: 401, body: { detail: 'not authenticated' } },
      'POST /api/auth/login': { body: { username: 'amy', threshold: 500 } },
    });
    setup();
    await userEvent.type(screen.getByLabelText('用户名'), 'amy');
    await userEvent.type(screen.getByLabelText('密码'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(lastRequest('POST', '/api/auth/login')).toBeDefined());
    expect(JSON.parse(String(lastRequest('POST', '/api/auth/login')!.init!.body))).toEqual({
      username: 'amy',
      password: 'password123',
    });
  });

  test('shows the server error detail', async () => {
    mockFetch({
      'GET /api/auth/me': { status: 401, body: { detail: 'not authenticated' } },
      'POST /api/auth/login': { status: 401, body: { detail: 'bad credentials' } },
    });
    setup();
    await userEvent.type(screen.getByLabelText('用户名'), 'amy');
    await userEvent.type(screen.getByLabelText('密码'), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('bad credentials');
  });

  test('switches to register mode and posts to the register endpoint', async () => {
    mockFetch({
      'GET /api/auth/me': { status: 401, body: { detail: 'not authenticated' } },
      'POST /api/auth/register': { body: { username: 'newbie', threshold: 500 } },
    });
    setup();
    await userEvent.click(screen.getByRole('button', { name: '没有账号？注册' }));
    await userEvent.type(screen.getByLabelText('用户名'), 'newbie');
    await userEvent.type(screen.getByLabelText('密码'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => expect(lastRequest('POST', '/api/auth/register')).toBeDefined());
  });
});
