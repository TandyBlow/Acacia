import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mockAdapter = vi.hoisted(() => ({
  initialize: vi.fn(),
  onAuthStateChange: vi.fn(() => () => {}),
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../api/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('../adapters/supabase/usernameAuth', () => ({
  usernameToSyntheticEmail: vi.fn(async (username: string) => `${username}@seewhat.local`),
}));

import { useAuthStore, setAuthAdapter } from './authStore';

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockAdapter.onAuthStateChange.mockReturnValue(() => {});
    setAuthAdapter(mockAdapter);
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

    mockAdapter.signIn.mockResolvedValueOnce({
      user: { id: 'u1', username: 'alice' },
    });

    await expect(store.submitByKnob()).resolves.toBe(true);

    expect(mockAdapter.signIn).toHaveBeenCalledWith('alice', 'secret');
    expect(store.isAuthenticated).toBe(true);
    expect(store.password).toBe('');
  });

  describe('assignUser username preservation', () => {
    it('preserves existing username when onAuthStateChange fires with empty username for same user', async () => {
      const store = useAuthStore();

      mockAdapter.initialize.mockResolvedValueOnce({ id: 'u1', username: 'alice' });
      await store.initialize();

      expect(store.currentUsername).toBe('alice');

      // Get the onAuthStateChange callback registered during initialize()
      const onAuthCallback = mockAdapter.onAuthStateChange.mock.calls[0][0];

      // Simulate auth state change with empty username (e.g., TOKEN_REFRESHED without user_metadata)
      onAuthCallback({ id: 'u1', username: '' });

      expect(store.currentUsername).toBe('alice');
    });

    it('does not preserve username across different user IDs', async () => {
      const store = useAuthStore();

      mockAdapter.initialize.mockResolvedValueOnce({ id: 'u1', username: 'alice' });
      await store.initialize();

      const onAuthCallback = mockAdapter.onAuthStateChange.mock.calls[0][0];
      onAuthCallback({ id: 'u2', username: '' });

      expect(store.currentUsername).toBe('');
    });

    it('sets user to null when onAuthStateChange fires with null', async () => {
      const store = useAuthStore();

      mockAdapter.initialize.mockResolvedValueOnce({ id: 'u1', username: 'alice' });
      await store.initialize();

      const onAuthCallback = mockAdapter.onAuthStateChange.mock.calls[0][0];
      onAuthCallback(null);

      expect(store.user).toBeNull();
      expect(store.isAuthenticated).toBe(false);
    });
  });
});
