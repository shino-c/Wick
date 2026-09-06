/**
 * bootstrap — one-time app start-up.
 *
 * Auth is deliberately frictionless: Wick has no sign-up screen in v1 because
 * nothing about the product needs an email address. When Supabase is configured
 * we create an anonymous auth user on first launch (enable "Anonymous sign-ins"
 * in Supabase → Authentication → Providers), which is enough to key RLS on.
 * When it isn't configured, everything runs against the local demo store.
 */
import { hasSupabase, supabase } from './supabaseClient';
import { readDb, writeDb } from '@/data/localStore';

export interface BootstrapResult {
  onboarded: boolean;
  backend: 'supabase' | 'local';
  warning: string | null;
}

export async function bootstrap(): Promise<BootstrapResult> {
  const db = await readDb();

  if (!hasSupabase) {
    return {
      onboarded: db.onboarded,
      backend: 'local',
      warning: null,
    };
  }

  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      return {
        onboarded: db.onboarded,
        backend: 'local',
        warning:
          'Could not reach Supabase — running on this device only. Enable anonymous sign-ins, or check .env.',
      };
    }
  }

  // Onboarding completion is a device-level fact, so it stays local either way.
  return { onboarded: db.onboarded, backend: 'supabase', warning: null };
}

export async function markOnboarded(): Promise<void> {
  await writeDb((db) => {
    db.onboarded = true;
  });
}
