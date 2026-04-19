import { supabase } from '../api/supabase';
import { usernameToSyntheticEmail } from './supabase/usernameAuth';
import type { AuthAdapter, AuthResult, AuthUser } from '../types/auth';
import { UI } from '../constants/uiStrings';

const CONFIG_ERROR = UI.errors.supabaseNotConfigured;

function toAuthUser(raw: { id: string; user_metadata?: Record<string, unknown> } | null): AuthUser | null {
  if (!raw) {
    return null;
  }
  const username = typeof raw.user_metadata?.username === 'string'
    ? raw.user_metadata.username
    : UI.errors.unknownUser;
  return { id: raw.id, username };
}

export const supabaseAuth: AuthAdapter = {
  async initialize(): Promise<AuthUser | null> {
    if (!supabase) {
      throw new Error(CONFIG_ERROR);
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw error;
    }
    return toAuthUser(data.session?.user ?? null);
  },

  onAuthStateChange(callback: (user: AuthUser | null) => void): () => void {
    if (!supabase) {
      return () => {};
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(toAuthUser(session?.user ?? null));
    });

    return () => {
      data.subscription.unsubscribe();
    };
  },

  async signUp(username: string, password: string): Promise<AuthResult> {
    if (!supabase) {
      throw new Error(CONFIG_ERROR);
    }

    const email = await usernameToSyntheticEmail(username);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });

    if (error) {
      throw error;
    }

    // signUp may not auto-confirm — try signing in immediately
    if (!data.session) {
      const signInResult = await supabase.auth.signInWithPassword({ email, password });
      if (signInResult.error) {
        const lower = signInResult.error.message.toLowerCase();
        if (lower.includes('confirm') && lower.includes('email')) {
          throw new Error(UI.errors.emailConfirmHint);
        }
        throw signInResult.error;
      }
      const user = toAuthUser(signInResult.data.session?.user ?? null);
      if (!user) {
        throw new Error(UI.errors.signupSuccessNoUser);
      }
      return { user };
    }

    const user = toAuthUser(data.session.user);
    if (!user) {
      throw new Error(UI.errors.signupSuccessNoUser);
    }
    return { user };
  },

  async signIn(username: string, password: string): Promise<AuthResult> {
    if (!supabase) {
      throw new Error(CONFIG_ERROR);
    }

    const email = await usernameToSyntheticEmail(username);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw error;
    }

    const user = toAuthUser(data.session?.user ?? null);
    if (!user) {
      throw new Error(UI.errors.loginFailed);
    }
    return { user };
  },

  async signOut(): Promise<void> {
    if (!supabase) {
      throw new Error(CONFIG_ERROR);
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }
  },
};
