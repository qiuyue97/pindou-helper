import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useToast } from '../state/ToastContext';

export default function AppShell() {
  const { me, logout, setThreshold } = useAuth();
  const { show } = useToast();
  // null means "follow the server value"; any string means the user is editing.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (me ? String(me.threshold) : '');

  async function saveThreshold() {
    const parsed = Number(value);
    if (value.trim() === '' || !Number.isInteger(parsed) || parsed < 0) {
      show('阈值应为不小于 0 的整数');
      return;
    }
    await setThreshold(parsed);
    setDraft(null);
    show(`低库存阈值已改为 ${parsed}`);
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>拼豆助手</h1>
        <nav>
          <NavLink to="/" end>
            库存
          </NavLink>
          <NavLink to="/match">配色</NavLink>
          <NavLink to="/colors">我的色卡</NavLink>
          <NavLink to="/history">历史</NavLink>
        </nav>
        <div className="topbar-right">
          <label htmlFor="threshold">低库存阈值</label>
          <input
            id="threshold"
            className="threshold"
            inputMode="numeric"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="button" onClick={() => void saveThreshold()}>
            保存阈值
          </button>
          <span>{me?.username}</span>
          <button type="button" onClick={() => void logout()}>
            退出
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
