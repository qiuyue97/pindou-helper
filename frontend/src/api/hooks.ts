import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from './client';
import type { ColorRow, InventoryRow, OperationRow, StockoutOut } from './types';

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
