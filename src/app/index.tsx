import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { hasSupabase, supabase } from '@/lib/supabaseClient';
import { colors } from '@/theme';

/**
 * Entry point.
 * - If Supabase is configured: check for an existing session.
 *   → Logged in  → go to /baseline (or /home if already onboarded).
 *   → Not logged in → go to /login.
 * - If Supabase is NOT configured (local demo mode) → go straight to /baseline.
 */
export default function Index() {
  const [checking, setChecking] = React.useState(true);
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);

  React.useEffect(() => {
    if (!hasSupabase) {
      // No Supabase → skip auth, go straight to baseline (demo mode).
      setChecking(false);
      setIsLoggedIn(true); // treat as "logged in" for demo mode
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session);
      setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.cream,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={colors.brown} />
      </View>
    );
  }

  if (isLoggedIn) {
    return <Redirect href="/baseline" />;
  }

  return <Redirect href="/login" />;
}

