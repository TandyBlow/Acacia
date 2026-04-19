const VALID_DATA_MODES = ['local', 'supabase', 'backend'] as const;
type DataMode = (typeof VALID_DATA_MODES)[number];

const rawMode = String(import.meta.env.VITE_DATA_MODE ?? 'local').toLowerCase();

export const config = {
  dataMode: (VALID_DATA_MODES.includes(rawMode as DataMode) ? rawMode : 'local') as DataMode,
  supabaseUrl: String(import.meta.env.VITE_SUPABASE_URL ?? ''),
  supabaseAnonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''),
  backendUrl: String(import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:7860'),
} as const;
