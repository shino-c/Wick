import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Remember me" for the login screen.
 *
 * Supabase always persists its session (persistSession: true in the client),
 * so remembering is modelled with our own flag: when it is false, a stored
 * session is treated as a leftover and signed out on the next app launch
 * (see src/app/index.tsx and the login screen's auth check). A missing flag
 * counts as remembered so existing installs keep working.
 */
const KEY = 'wick.rememberMe';

export async function getRememberMe(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== 'false';
  } catch {
    return true;
  }
}

export async function setRememberMe(remember: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, remember ? 'true' : 'false');
  } catch {
    // Storage unavailable — default to remembered; worst case is an extra login.
  }
}
