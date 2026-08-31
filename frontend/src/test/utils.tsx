import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

export function renderWithProviders(ui: ReactNode, opts: { route?: string } = {}): RenderResult {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? '/']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

interface MockResult {
  status?: number;
  body?: unknown;
}
type MockRoute = MockResult | ((req: { url: string; init?: RequestInit }) => MockResult);

const calls: { method: string; url: string; init?: RequestInit }[] = [];

export function mockFetch(routes: Record<string, MockRoute>): void {
  calls.length = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, init });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === method && url === p;
    });
    if (!key) throw new Error(`mockFetch: no route for ${method} ${url}`);
    const route = routes[key]!;
    const res = typeof route === 'function' ? route({ url, init }) : route;
    const status = res.status ?? 200;
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

export function lastRequest(method: string, path: string) {
  return [...calls].reverse().find((c) => c.method === method.toUpperCase() && c.url === path);
}
