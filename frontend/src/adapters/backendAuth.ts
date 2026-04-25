import { config } from '../config';
import type { AuthAdapter, AuthResult, AuthUser } from '../types/auth';

const TOKEN_KEY = 'acacia_backend_token';

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

let currentUser: AuthUser | null = null;
let authCallback: ((user: AuthUser | null) => void) | null = null;

export const backendAuth: AuthAdapter = {
  async initialize(): Promise<AuthUser | null> {
    const token = getToken();
    if (!token) return null;

    try {
      const res = await fetch(`${config.backendUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setToken(null);
        return null;
      }
      const data = await res.json();
      currentUser = { id: data.id, username: data.username };
      return currentUser;
    } catch {
      setToken(null);
      return null;
    }
  },

  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void {
    authCallback = callback;
    return () => { authCallback = null; };
  },

  async signUp(username: string, password: string): Promise<AuthResult> {
    const res = await fetch(`${config.backendUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const text = await res.text();
      try {
        const err = JSON.parse(text);
        throw new Error(err.detail || 'Registration failed');
      } catch {
        throw new Error(text || 'Registration failed');
      }
    }

    const data = await res.json();
    setToken(data.token);
    const user: AuthUser = { id: data.user.id, username: data.user.username };
    currentUser = user;
    authCallback?.(currentUser);
    return { user };
  },

  async signIn(username: string, password: string): Promise<AuthResult> {
    const res = await fetch(`${config.backendUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const text = await res.text();
      try {
        const err = JSON.parse(text);
        throw new Error(err.detail || 'Login failed');
      } catch {
        throw new Error(text || 'Login failed');
      }
    }

    const data = await res.json();
    setToken(data.token);
    const user: AuthUser = { id: data.user.id, username: data.user.username };
    currentUser = user;
    authCallback?.(currentUser);
    return { user };
  },

  async signOut(): Promise<void> {
    setToken(null);
    currentUser = null;
    authCallback?.(null);
  },
};
