import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { AuthUser } from '../types/auth';
import type { AuthAdapter } from '../types/auth';

export type AuthMode = 'login' | 'register';

function formatAuthError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '认证失败，请稍后重试。';
}

let authAdapter: AuthAdapter | null = null;

export function setAuthAdapter(adapter: AuthAdapter): void {
  authAdapter = adapter;
}

export const useAuthStore = defineStore('auth', () => {
  const initialized = ref(false);
  const mode = ref<AuthMode>('login');

  const username = ref('');
  const password = ref('');
  const confirmPassword = ref('');

  const user = ref<AuthUser | null>(null);

  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);

  const isAuthenticated = computed(() => Boolean(user.value));
  const currentUsername = computed(() => {
    if (user.value?.username) {
      return user.value.username;
    }

    const inputUsername = username.value.trim();
    if (inputUsername.length > 0) {
      return inputUsername;
    }

    return '未知用户';
  });
  const isRegisterMode = computed(() => mode.value === 'register');
  const canSubmit = computed(() => {
    if (isBusy.value) {
      return false;
    }
    if (username.value.length === 0 || password.value.length === 0) {
      return false;
    }
    if (!isRegisterMode.value) {
      return true;
    }
    return (
      confirmPassword.value.length > 0 &&
      confirmPassword.value === password.value
    );
  });

  function assignUser(next: AuthUser | null): void {
    user.value = next;
  }

  function toggleMode(): void {
    mode.value = mode.value === 'login' ? 'register' : 'login';
    errorMessage.value = null;
  }

  function clearSecretsAfterSuccess(): void {
    password.value = '';
    confirmPassword.value = '';
  }

  function clearAuthFormState(): void {
    mode.value = 'login';
    username.value = '';
    password.value = '';
    confirmPassword.value = '';
  }

  async function initialize(): Promise<void> {
    if (initialized.value || !authAdapter) {
      initialized.value = true;
      return;
    }

    try {
      const currentUser = await authAdapter.initialize();
      assignUser(currentUser);
    } catch (error) {
      errorMessage.value = formatAuthError(error);
    }

    authAdapter.onAuthStateChange((nextUser) => {
      assignUser(nextUser);
      if (nextUser) {
        errorMessage.value = null;
      }
    });

    initialized.value = true;
  }

  async function submitByKnob(): Promise<boolean> {
    if (!authAdapter) {
      errorMessage.value = '认证服务未初始化。';
      return false;
    }

    if (!canSubmit.value) {
      if (isRegisterMode.value && confirmPassword.value !== password.value) {
        errorMessage.value = '两次输入的密码不一致。';
      }
      return false;
    }

    isBusy.value = true;
    errorMessage.value = null;

    try {
      let result;

      if (isRegisterMode.value) {
        result = await authAdapter.signUp(username.value, password.value);
      } else {
        result = await authAdapter.signIn(username.value, password.value);
      }

      assignUser(result.user);
      clearSecretsAfterSuccess();
      return true;
    } catch (error) {
      errorMessage.value = formatAuthError(error);
      return false;
    } finally {
      isBusy.value = false;
    }
  }

  async function logout(): Promise<boolean> {
    if (!authAdapter || isBusy.value) {
      return false;
    }

    isBusy.value = true;
    try {
      await authAdapter.signOut();
      assignUser(null);
      clearAuthFormState();
      errorMessage.value = null;
      return true;
    } catch {
      return false;
    } finally {
      isBusy.value = false;
    }
  }

  return {
    initialized,
    mode,
    username,
    password,
    confirmPassword,
    user,
    isBusy,
    errorMessage,
    isAuthenticated,
    currentUsername,
    isRegisterMode,
    canSubmit,
    initialize,
    toggleMode,
    submitByKnob,
    logout,
  };
});
