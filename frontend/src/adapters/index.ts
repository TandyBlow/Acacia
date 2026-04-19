import { config } from '../config';
import type { DataAdapter } from '../types/node';
import type { AuthAdapter } from '../types/auth';

export interface AdapterPair {
  data: DataAdapter;
  auth: AuthAdapter;
}

export async function loadAdapters(): Promise<AdapterPair> {
  switch (config.dataMode) {
    case 'supabase': {
      const [{ supabaseAdapter }, { supabaseAuth }] = await Promise.all([
        import('./supabaseAdapter'),
        import('./supabaseAuth'),
      ]);
      return { data: supabaseAdapter, auth: supabaseAuth };
    }
    case 'backend': {
      const [{ backendAdapter }, { backendAuth }] = await Promise.all([
        import('./backendAdapter'),
        import('./backendAuth'),
      ]);
      return { data: backendAdapter, auth: backendAuth };
    }
    case 'local':
    default: {
      const [{ localAdapter }, { localAuth }] = await Promise.all([
        import('./localAdapter'),
        import('./localAuth'),
      ]);
      return { data: localAdapter, auth: localAuth };
    }
  }
}
