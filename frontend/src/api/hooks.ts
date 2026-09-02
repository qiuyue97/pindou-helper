import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from './client';
import type {
  ColorRow,
  InventoryRow,
  OperationRow,
  PatternJobSummary,
  Sheet,
  SheetSummary,
  StockoutOut,
} from './types';

export function useInventory() {
  return useQuery({
    queryKey: ['inventory'],
    queryFn: () => apiGet<InventoryRow[]>('/api/inventory'),
  });
}

export function useOperations(limit = 50) {
  return useQuery({
    queryKey: ['operations', limit],
    queryFn: () => apiGet<OperationRow[]>(`/api/operations?limit=${limit}`),
  });
}

export function useUserColors() {
  return useQuery({ queryKey: ['colors'], queryFn: () => apiGet<ColorRow[]>('/api/colors') });
}

export function useStockout() {
  return useQuery({
    queryKey: ['stockout'],
    queryFn: () => apiGet<StockoutOut>('/api/inventory/stockout'),
  });
}

/**
 * Recognition runs in a background thread on the server, so the only way to
 * learn it finished is to ask. Poll briskly while something is running and
 * slowly otherwise; `enabled` keeps normal accounts from polling a 403.
 */
export function usePatternJobs(enabled: boolean) {
  return useQuery({
    queryKey: ['patterns'],
    enabled,
    queryFn: () => apiGet<PatternJobSummary>('/api/patterns'),
    refetchInterval: (query) => (query.state.data?.running ? 3000 : 30000),
  });
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['inventory'] }),
      qc.invalidateQueries({ queryKey: ['operations'] }),
      qc.invalidateQueries({ queryKey: ['stockout'] }),
    ]);
  };
}

export function useApiMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  opts: { invalidate?: boolean } = {},
) {
  const invalidateAll = useInvalidateAll();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      if (opts.invalidate !== false) await invalidateAll();
    },
  });
}

/**
 * 识别在服务端的后台线程里跑，只能靠问。在跑的时候勤问，跑完了就别再问。
 * `enabled` 让普通账号不去撞 403。
 */
export function useSheet(id: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['sheet', id],
    enabled: enabled && id != null,
    queryFn: () => apiGet<Sheet>(`/api/sheets/${id}`),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'pending' || s === 'running' ? 2000 : false;
    },
  });
}

export function useSheets(enabled: boolean) {
  return useQuery({
    queryKey: ['sheets'],
    enabled,
    queryFn: () => apiGet<SheetSummary>('/api/sheets'),
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
}
