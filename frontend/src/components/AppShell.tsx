import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';

export default function AppShell() {
  const { me, logout } = useAuth();

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
