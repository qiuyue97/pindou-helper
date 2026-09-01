import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../state/AuthContext';

type Mode = 'login' | 'register';

/** Mirrors USERNAME_RE in backend/app/schemas.py. Checked here only so the
 *  rules are visible before submitting; the server stays authoritative. */
const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;
const MIN_PASSWORD = 8;

export default function LoginForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';
  const label = isRegister ? '注册' : '登录';

  function switchTo(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setError('');
    setConfirm('');
  }

  /** Register-only pre-flight. Returns '' when there is nothing to complain about. */
  function localError(): string {
    if (!isRegister) return '';
    if (!USERNAME_RE.test(username)) return '用户名需 3–32 位，只能用字母、数字、下划线或连字符';
    if (password.length < MIN_PASSWORD) return `密码至少 ${MIN_PASSWORD} 位`;
    if (confirm !== password) return '两次输入的密码不一致';
    return '';
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const local = localError();
    if (local) {
      setError(local);
      return;
    }
    setError('');
    setBusy(true);
    try {
      await (isRegister ? register(username, password) : login(username, password));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : '请求失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`login ${isRegister ? 'is-register' : 'is-login'}`}>
      <h1>拼豆助手</h1>

      {/* Tabs rather than a single toggle link: the current mode stays visible
          the whole time instead of only being implied by the button label. */}
      <div className="auth-tabs" role="tablist" aria-label="登录或注册">
        {(['login', 'register'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            className="auth-tab"
            aria-selected={mode === m}
            onClick={() => switchTo(m)}
          >
            {m === 'login' ? '登录' : '注册'}
          </button>
        ))}
      </div>

      <p className="auth-lede" data-testid="auth-lede">
        {isRegister
          ? '创建一个新账号。豆仓从空白开始，数据只属于这个账号。'
          : '用已有账号登录，继续管理你的豆仓。'}
      </p>

      <form onSubmit={onSubmit}>
        <label htmlFor="username">用户名</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        {isRegister && <p className="field-hint">3–32 位，字母、数字、下划线或连字符</p>}

        <label htmlFor="password">密码</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
        />
        {isRegister && <p className="field-hint">至少 {MIN_PASSWORD} 位</p>}

        {isRegister && (
          <>
            <label htmlFor="confirm">确认密码</label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </>
        )}

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy}>
          {label}
        </button>
      </form>
    </div>
  );
}
