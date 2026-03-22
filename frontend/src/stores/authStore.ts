import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../api/supabase';
import { usernameToSyntheticEmail } from '../services/usernameAuth';

export type AuthMode = 'login' | 'register';

const CONFIG_ERROR =
  'Supabase 未配置。请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。';
const EMAIL_CONFIRM_HINT =
  '当前项目仍开启了邮箱确认。请在 Supabase Authentication 设置中关闭 Confirm email。';

function formatAuthError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '认证失败，请稍后重试。';
}

export const useAuthStore = defineStore('auth', () => {
  const initialized = ref(false);
  const mode = ref<AuthMode>('login');

  const username = ref('');
  const password = ref('');
  const confirmPassword = ref('');

  const session = ref<Session | null>(null);
  const user = ref<User | null>(null);

  const isBusy = ref(false);
  const errorMessage = ref<string | null>(null);

  const isAuthenticated = computed(() => Boolean(user.value));
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

  function assignSession(next: Session | null): void {
    session.value = next;
    user.value = next?.user ?? null;
  }

  function toggleMode(): void {
    mode.value = mode.value === 'login' ? 'register' : 'login';
    errorMessage.value = null;
  }

  function clearSecretsAfterSuccess(): void {
    password.value = '';
    confirmPassword.value = '';
  }

  async function initialize(): Promise<void> {
    if (initialized.value) {
      return;
    }

    if (!supabase) {
      errorMessage.value = CONFIG_ERROR;
      initialized.value = true;
      return;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      errorMessage.value = formatAuthError(error);
    } else {
      assignSession(data.session);
    }

    supabase.auth.onAuthStateChange((_event, nextSession) => {
      assignSession(nextSession);
      if (nextSession) {
        errorMessage.value = null;
      }
    });

    initialized.value = true;
  }

  async function submitByKnob(): Promise<boolean> {
    if (!supabase) {
      errorMessage.value = CONFIG_ERROR;
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
      const email = await usernameToSyntheticEmail(username.value);

      if (isRegisterMode.value) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password: password.value,
          options: {
            data: {
              username: username.value,
            },
          },
        });

        if (error) {
          throw error;
        }

        if (data.session) {
          assignSession(data.session);
          clearSecretsAfterSuccess();
          return true;
        }

        const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password: password.value,
        });

        if (loginError) {
          const lower = loginError.message.toLowerCase();
          if (lower.includes('confirm') && lower.includes('email')) {
            errorMessage.value = EMAIL_CONFIRM_HINT;
            return false;
          }
          throw loginError;
        }

        assignSession(loginData.session);
        clearSecretsAfterSuccess();
        return true;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: password.value,
      });

      if (error) {
        throw error;
      }

      assignSession(data.session);
      clearSecretsAfterSuccess();
      return true;
    } catch (error) {
      errorMessage.value = formatAuthError(error);
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
    session,
    user,
    isBusy,
    errorMessage,
    isAuthenticated,
    isRegisterMode,
    canSubmit,
    initialize,
    toggleMode,
    submitByKnob,
  };
});
