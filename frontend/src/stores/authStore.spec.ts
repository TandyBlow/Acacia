import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const authFns = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../api/supabase', () => ({
  supabase: {
    auth: authFns,
  },
}));

vi.mock('../services/usernameAuth', () => ({
  usernameToSyntheticEmail: vi.fn(async (username: string) => `${username}@seewhat.local`),
}));

import { useAuthStore } from './authStore';

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    authFns.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  });

  it('requires matching passwords in register mode', () => {
    const store = useAuthStore();

    store.toggleMode();
    store.username = 'alice';
    store.password = 'secret';
    store.confirmPassword = 'different';

    expect(store.isRegisterMode).toBe(true);
    expect(store.canSubmit).toBe(false);
  });

  it('submits login and updates authenticated state on success', async () => {
    const store = useAuthStore();

    store.username = 'alice';
    store.password = 'secret';

    authFns.signInWithPassword.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            id: 'u1',
            user_metadata: { username: 'alice' },
          },
        },
      },
      error: null,
    });

    await expect(store.submitByKnob()).resolves.toBe(true);

    expect(authFns.signInWithPassword).toHaveBeenCalledWith({
      email: 'alice@seewhat.local',
      password: 'secret',
    });
    expect(store.isAuthenticated).toBe(true);
    expect(store.password).toBe('');
  });
});
