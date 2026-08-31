import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { ApiError, apiGet, apiSend } from '../api/client';
import type { Me } from '../api/types';

interface AuthValue {
  me: Me | undefined;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setThreshold: (threshold: number) => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    retry: false,
    queryFn: async () => {
      try {
        return await apiGet<Me>('/api/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });

  const refresh = () => qc.invalidateQueries();

  const loginM = useMutation({
    mutationFn: (v: { path: string; username: string; password: string }) =>
      apiSend<Me>('POST', v.path, { username: v.username, password: v.password }),
    onSuccess: refresh,
  });

  const logoutM = useMutation({
    mutationFn: () => apiSend<void>('POST', '/api/auth/logout'),
    onSuccess: () => {
      qc.setQueryData(['me'], null);
      return refresh();
    },
  });

  const thresholdM = useMutation({
    mutationFn: (threshold: number) =>
      apiSend<{ threshold: number }>('PATCH', '/api/settings', { threshold }),
    onSuccess: async () => {
      // The stockout list is computed SERVER-side from this threshold, so it has
      // to be refetched too — invalidating ['me'] alone leaves it stale until a
      // full page reload. (The inventory tiers are derived client-side from
      // me.threshold, so those re-render on their own.)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['me'] }),
        qc.invalidateQueries({ queryKey: ['stockout'] }),
      ]);
    },
  });

  const value: AuthValue = {
    me: me ?? undefined,
    isLoading,
    login: async (username, password) => {
      await loginM.mutateAsync({ path: '/api/auth/login', username, password });
    },
    register: async (username, password) => {
      await loginM.mutateAsync({ path: '/api/auth/register', username, password });
    },
    logout: async () => {
      await logoutM.mutateAsync();
    },
    setThreshold: async (t) => {
      await thresholdM.mutateAsync(t);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
