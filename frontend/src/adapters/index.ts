import { config } from '../config';
import { localAdapter } from './localAdapter';
import { supabaseAdapter } from './supabaseAdapter';

export { clearLocalNodeCache } from './localAdapter';

export const dataAdapter =
  config.dataMode === 'supabase' ? supabaseAdapter : localAdapter;
