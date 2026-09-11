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

  if (!session?.user) {
    return {
      onboarded: false,
      backend: 'supabase',
      warning: null,
      authenticated: false,
    };
  }

  // Query this signed-in user's profile to see if they completed baseline setup
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarded')
    .eq('id', session.user.id)
    .maybeSingle();

  const isOnboarded = profile?.onboarded ?? false;

  return {
    onboarded: isOnboarded,
    backend: 'supabase',
    warning: null,
    authenticated: true,
  };
}

export async function markOnboarded(): Promise<void> {
  if (hasSupabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await supabase
        .from('profiles')
        .update({ onboarded: true })
        .eq('id', user.id);
    }
  }

  await writeDb((db) => {
    db.onboarded = true;
  });
}

