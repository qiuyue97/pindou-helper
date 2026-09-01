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
    await userEvent.click(screen.getByRole('tab', { name: '注册' }));
    await userEvent.type(screen.getByLabelText('用户名'), 'newbie');
    await userEvent.type(screen.getByLabelText('密码'), 'password123');
    await userEvent.type(screen.getByLabelText('确认密码'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => expect(lastRequest('POST', '/api/auth/register')).toBeDefined());
  });

  test('the selected tab and the fields both change with the mode', async () => {
    mockFetch({ 'GET /api/auth/me': { status: 401, body: { detail: 'not authenticated' } } });
    setup();
    // Login mode: no confirm field, login tab selected.
    expect(screen.getByRole('tab', { name: '登录' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText('确认密码')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: '注册' }));
    expect(screen.getByRole('tab', { name: '注册' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '登录' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByLabelText('确认密码')).toBeInTheDocument();
  });

  test('register refuses mismatched passwords without calling the server', async () => {
    mockFetch({ 'GET /api/auth/me': { status: 401, body: { detail: 'not authenticated' } } });
    setup();
    await userEvent.click(screen.getByRole('tab', { name: '注册' }));
    await userEvent.type(screen.getByLabelText('用户名'), 'newbie');
    await userEvent.type(screen.getByLabelText('密码'), 'password123');
    await userEvent.type(screen.getByLabelText('确认密码'), 'password124');
    await userEvent.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('两次输入的密码不一致');
    expect(lastRequest('POST', '/api/auth/register')).toBeUndefined();
  });

  test('register rejects a username the server would reject anyway', async () => {
    mockFetch({ 'GET /api/auth/me': { status: 401, body: { detail: 'not authenticated' } } });
    setup();
    await userEvent.click(screen.getByRole('tab', { name: '注册' }));
    await userEvent.type(screen.getByLabelText('用户名'), 'ab');
    await userEvent.type(screen.getByLabelText('密码'), 'password123');
    await userEvent.type(screen.getByLabelText('确认密码'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('3–32 位');
    expect(lastRequest('POST', '/api/auth/register')).toBeUndefined();
  });
});
