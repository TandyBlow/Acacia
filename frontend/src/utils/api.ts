import { config } from '../config';

const TOKEN_KEY = 'acacia_backend_token';
const REQUEST_TIMEOUT_MS = 15_000;

export function getToken(): string | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  // Hung requests never settle, latching callers' in-flight guards.
  const signal =
    options?.signal ??
    (typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      : null);
  const res = await fetch(`${config.backendUrl}${path}`, { ...options, headers, signal });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
