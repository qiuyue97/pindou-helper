import { Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import LoginForm from './components/LoginForm';
import HistoryPage from './routes/HistoryPage';
import MatchPage from './routes/MatchPage';
import MyColorsPage from './routes/MyColorsPage';
import SheetPage from './routes/SheetPage';
import InventoryPage from './routes/InventoryPage';
import { useAuth } from './state/AuthContext';

export default function App() {
  const { me, isLoading } = useAuth();

  if (isLoading) return <p className="app">加载中…</p>;
  if (!me) return <LoginForm />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<InventoryPage />} />
        <Route path="match" element={<MatchPage />} />
        <Route path="sheet" element={<SheetPage />} />
        <Route path="sheet/:sheetId" element={<SheetPage />} />
        <Route path="colors" element={<MyColorsPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
    </Routes>
  );
}
