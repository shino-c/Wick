import { readDb, writeDb } from '@/data/localStore';
import { isDemoActive, setupDemoMode } from './demoMode';
import { hasSupabase, supabase } from './supabaseClient';

export interface BootstrapResult {
  onboarded: boolean;
  backend: 'supabase' | 'local';
  warning: string | null;
  authenticated: boolean;
  /** True when nothing is configured and the simulation week is in use. */
  demo: boolean;
}

export async function bootstrap(): Promise<BootstrapResult> {
  // Configure the simulation before anything reads the week's data. When there
  // is no Supabase project and nothing of the user's own on this device, this
  // seeds one realistic week — which is what makes a fresh clone run with zero
  // setup instead of showing an empty dashboard.
  await setupDemoMode();

  const db = await readDb();

  // Supabase isn't configured — use the local demo store.
  if (!hasSupabase) {
    return {
      onboarded: db.onboarded,
      backend: 'local',
      warning: null,
      authenticated: false,
      demo: isDemoActive(),
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
      demo: false,
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
    demo: false,
  };
}

/**
 * Marks setup complete.
 *
 * In simulation mode there is no account to update, so this writes only the
 * local flag — the same place the local backend keeps it either way.
 */
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

