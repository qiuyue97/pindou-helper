import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test } from 'vitest';
import { mockFetch } from '../test/utils';
import { useEffectiveCatalog } from './useEffectiveCatalog';

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('useEffectiveCatalog', () => {
  test('merges overrides and customs over the base catalogue', async () => {
    mockFetch({
      'GET /api/colors': {
        body: [
          { code: 'C7', hex: '9D5B3E', source: 'override', base_hex: '3677D2' },
          { code: 'X1', hex: 'A03D2F', source: 'custom', base_hex: null },
        ],
      },
    });
    const { result } = renderHook(() => useEffectiveCatalog(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.colors).toHaveLength(292);
    expect(result.current.byCode.get('C7')).toMatchObject({ hex: '9D5B3E', source: 'override' });
    expect(result.current.byCode.get('X1')).toMatchObject({ hex: 'A03D2F', source: 'custom' });
    expect(result.current.byCode.get('A1')).toMatchObject({ source: 'base' });
  });

  test('falls back to the base catalogue before colours load', () => {
    mockFetch({ 'GET /api/colors': { body: [] } });
    const { result } = renderHook(() => useEffectiveCatalog(), { wrapper });
    expect(result.current.colors).toHaveLength(291);
  });
});
