// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api';

const TOKEN_KEY = 'acacia_backend_token';

describe('apiFetch request headers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(TOKEN_KEY);
  });

  it('keeps caller headers such as If-Match alongside the defaults', async () => {
    localStorage.setItem(TOKEN_KEY, 'test-token');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/nodes/node-1/content', {
      method: 'PATCH',
      body: JSON.stringify({ content: 'x' }),
      headers: { 'If-Match': '"7"' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('If-Match')).toBe('"7"');
    expect(headers.get('Authorization')).toBe('Bearer test-token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('sends defaults without caller headers when none are passed', async () => {
    localStorage.setItem(TOKEN_KEY, 'test-token');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/tree');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('Authorization')).toBe('Bearer test-token');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('If-Match')).toBeNull();
  });
});
