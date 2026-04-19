import type { AuthAdapter, AuthResult, AuthUser } from '../types/auth';
import { LOCAL_USERS_KEY, LOCAL_SESSION_KEY } from '../constants/app';
import { UI } from '../constants/uiStrings';

interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function generateUserId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readStoredUsers(): StoredUser[] {
  const raw = localStorage.getItem(LOCAL_USERS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredUsers(users: StoredUser[]): void {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
}

function readSession(): AuthUser | null {
  const raw = localStorage.getItem(LOCAL_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string' && typeof parsed.username === 'string') {
      return parsed as AuthUser;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeSession(user: AuthUser | null): void {
  if (user) {
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  }
}

export const localAuth: AuthAdapter = {
  async initialize(): Promise<AuthUser | null> {
    return readSession();
  },

  onAuthStateChange(): () => void {
    // Local auth has no real-time state change mechanism
    return () => {};
  },

  async signUp(username: string, password: string): Promise<AuthResult> {
    const trimmed = username.trim();
    if (!trimmed) {
      throw new Error(UI.errors.usernameEmpty);
    }
    if (!password) {
      throw new Error(UI.errors.passwordEmpty);
    }

    const users = readStoredUsers();
    if (users.some((u) => u.username === trimmed)) {
      throw new Error(UI.errors.usernameTaken);
    }

    const passwordHash = await sha256Hex(password);
    const user: StoredUser = {
      id: generateUserId(),
      username: trimmed,
      passwordHash,
    };

    users.push(user);
    writeStoredUsers(users);

    const authUser: AuthUser = { id: user.id, username: user.username };
    writeSession(authUser);
    return { user: authUser };
  },

  async signIn(username: string, password: string): Promise<AuthResult> {
    const trimmed = username.trim();
    if (!trimmed || !password) {
      throw new Error(UI.errors.usernamePasswordEmpty);
    }

    const users = readStoredUsers();
    const passwordHash = await sha256Hex(password);
    const matched = users.find((u) => u.username === trimmed && u.passwordHash === passwordHash);

    if (!matched) {
      throw new Error(UI.errors.usernamePasswordWrong);
    }

    const authUser: AuthUser = { id: matched.id, username: matched.username };
    writeSession(authUser);
    return { user: authUser };
  },

  async signOut(): Promise<void> {
    writeSession(null);
  },
};
