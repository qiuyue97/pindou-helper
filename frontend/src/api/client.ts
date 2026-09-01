export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function toError(res: Response): Promise<ApiError> {
  let detail = res.statusText || `request failed (${res.status})`;
  try {
    const data = (await res.json()) as { detail?: unknown };
    if (typeof data.detail === 'string') detail = data.detail;
    else if (data.detail != null) detail = JSON.stringify(data.detail);
  } catch {
    // non-JSON error body — keep the status text
  }
  return new ApiError(res.status, detail);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'GET', credentials: 'include' });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'pindou' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Multipart upload. The browser must set its own Content-Type (it carries the
 *  boundary), so unlike apiSend this one deliberately does not set it. */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'pindou' },
    body: form,
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}
