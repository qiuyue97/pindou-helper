import LoginForm from './components/LoginForm';
import { useAuth } from './state/AuthContext';

export default function App() {
  const { me, isLoading } = useAuth();

  if (isLoading) return <p className="app">加载中…</p>;
  if (!me) return <LoginForm />;

  return (
    <main className="app">
      <h1>拼豆助手</h1>
      <span>{me.username}</span>
    </main>
  );
}
