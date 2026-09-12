import 'react-native-url-polyfill/auto';

import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Supabase is configured when both values exist.
 *
 * IMPORTANT:
 * The publishable/anon key is NOT a secret.
 * Supabase security must come from Auth + RLS.
 */
export const hasSupabase = Boolean(
  supabaseUrl &&
    supabasePublishableKey &&
    !supabaseUrl.includes('YOUR-PROJECT')
);

/**
 * Expo Router Web performs server-side rendering.
 *
 * During SSR:
 *   window === undefined
 *
 * Therefore Web storage must never access window during SSR.
 */
const webStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.localStorage.getItem(key);
  },

  setItem: async (key: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(key, value);
  },

  removeItem: async (key: string): Promise<void> => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.removeItem(key);
  },
};

/**
 * Native:
 *   AsyncStorage
 *
 * Web:
 *   browser localStorage with SSR protection
 */
const authStorage =
  Platform.OS === 'web'
    ? webStorage
    : AsyncStorage;

export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? 'http://localhost:54321',
  supabasePublishableKey ?? 'invalid-key',
  {
    auth: {
      storage: authStorage,

      autoRefreshToken: true,

      persistSession: true,

      detectSessionInUrl: false,
    },
  }
);

/**
 * Keep native Supabase sessions refreshed while the app
 * is in the foreground.
 */
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

/**
 * Returns the currently authenticated user ID.
 */
export async function currentUserId(): Promise<string | null> {
  if (!hasSupabase) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user.id;
}
