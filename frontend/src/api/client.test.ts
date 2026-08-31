import { describe, expect, test } from 'vitest';
import { ApiError, apiGet, apiSend } from './client';
import { lastRequest, mockFetch } from '../test/utils';

describe('apiGet', () => {
  test('returns parsed JSON and sends credentials', async () => {
    mockFetch({ 'GET /api/auth/me': { body: { username: 'amy', threshold: 500 } } });
    await expect(apiGet('/api/auth/me')).resolves.toEqual({ username: 'amy', threshold: 500 });
    expect(lastRequest('GET', '/api/auth/me')?.init?.credentials).toBe('include');
  });

  test('throws ApiError carrying status and detail', async () => {
    mockFetch({ 'GET /api/auth/me': { status: 401, body: { detail: 'not authenticated' } } });
    await expect(apiGet('/api/auth/me')).rejects.toMatchObject({
      status: 401,
      detail: 'not authenticated',
    });
    await expect(apiGet('/api/auth/me')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('apiSend', () => {
  test('adds the CSRF header and JSON body', async () => {
    mockFetch({ 'PUT /api/inventory/A1': { body: { changes: [] } } });
    await apiSend('PUT', '/api/inventory/A1', { quantity: 5 });
    const req = lastRequest('PUT', '/api/inventory/A1')!;
    const headers = new Headers(req.init?.headers);
    expect(headers.get('X-Requested-With')).toBe('pindou');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(req.init?.body).toBe(JSON.stringify({ quantity: 5 }));
  });

  test('handles 204 with no body', async () => {
    mockFetch({ 'POST /api/auth/logout': { status: 204 } });
    await expect(apiSend('POST', '/api/auth/logout')).resolves.toBeUndefined();
  });
});
