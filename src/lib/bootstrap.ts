import { readDb, writeDb } from '@/data/localStore';
import { hasSupabase, supabase } from './supabaseClient';

export interface BootstrapResult {
  onboarded: boolean;
  backend: 'supabase' | 'local';
  warning: string | null;
  authenticated: boolean;
}

export async function bootstrap(): Promise<BootstrapResult> {
  const db = await readDb();

  // Supabase isn't configured — use the local demo store.
  if (!hasSupabase) {
    return {
      onboarded: db.onboarded,
      backend: 'local',
      warning: null,
      authenticated: false,
    };
  }

  // Check for an existing normal Supabase login.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    onboarded: db.onboarded,
    backend: 'supabase',
    warning: null,
    authenticated: !!session,
  };
}

export async function markOnboarded(): Promise<void> {
  await writeDb((db) => {
    db.onboarded = true;
  });
}
