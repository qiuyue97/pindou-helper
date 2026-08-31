import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../state/AuthContext';

export default function LoginForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const label = mode === 'login' ? '登录' : '注册';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await (mode === 'login' ? login(username, password) : register(username, password));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '请求失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <h1>拼豆助手</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="username">用户名</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />

        <label htmlFor="password">密码</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy}>
          {label}
        </button>
      </form>

      <button
        type="button"
        className="linklike"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError('');
        }}
      >
        {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
      </button>
    </div>
  );
}
