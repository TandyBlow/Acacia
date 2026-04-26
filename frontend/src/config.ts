const VALID_DATA_MODES = ['local', 'backend'] as const;
type DataMode = (typeof VALID_DATA_MODES)[number];

const rawMode = String(import.meta.env.VITE_DATA_MODE ?? 'backend').toLowerCase();

export const config = {
  dataMode: (VALID_DATA_MODES.includes(rawMode as DataMode) ? rawMode : 'backend') as DataMode,
  backendUrl: String(import.meta.env.VITE_BACKEND_URL ?? '/api'),
} as const;
