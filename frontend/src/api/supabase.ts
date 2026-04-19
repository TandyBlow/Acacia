import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  if (!_supabase) {
    _supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  }
  return _supabase;
}

export const supabase = getSupabase();
