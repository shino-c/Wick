import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * True when .env is filled in. When false the app still runs end-to-end against
 * the local demo store (src/data/localStore.ts) — useful for UI work and for
 * demoing on a laptop with no network.
 */
export const hasSupabase = Boolean(url && anonKey && !url.includes('YOUR-PROJECT'));

export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'anon',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

export async function currentUserId(): Promise<string | null> {
  if (!hasSupabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
