export const config = {
  dataMode: String(import.meta.env.VITE_DATA_MODE ?? 'local').toLowerCase(),
  supabaseUrl: String(import.meta.env.VITE_SUPABASE_URL ?? ''),
  supabaseAnonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''),
} as const;
