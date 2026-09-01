import { History, LogOut, Palette, SwatchBook, Boxes } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { greetingFor } from '../lib/greeting';
import { useVip } from '../state/useVip';
import VipBadge from './VipBadge';
import { useAuth } from '../state/AuthContext';

const TABS = [
  { to: '/', label: '库存', Icon: Boxes, end: true },
  { to: '/match', label: '配色', Icon: Palette, end: false },
  { to: '/colors', label: '我的色卡', Icon: SwatchBook, end: false },
  { to: '/history', label: '历史', Icon: History, end: false },
];

export default function AppShell() {
  const { me, logout } = useAuth();
  const { isVip } = useVip();

  return (
    <div className="app">
      <header className="topbar">
        <h1>拼豆助手</h1>
        <nav>
          {TABS.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={16} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          <span className="greeting">{greetingFor()}，</span>
          {isVip && <VipBadge />}
          <span className="username">{me?.username}</span>
          <button type="button" className="ghost" onClick={() => void logout()}>
            <LogOut size={15} aria-hidden="true" />
            退出
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
