import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { bootstrap } from '@/lib/bootstrap';
import { hasSupabase, supabase } from '@/lib/supabaseClient';
import { colors } from '@/theme';

export default function Index() {
  const [checking, setChecking] = React.useState(true);
  const [route, setRoute] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!hasSupabase) {
        setRoute('/baseline');
        return;
      }

      const { data } = await supabase.auth.getSession();
      const loggedIn = !!data.session;

      if (!loggedIn) {
        if (!cancelled) setRoute('/login');
        return;
      }

      const { onboarded } = await bootstrap();
      if (!cancelled) {
        setRoute(onboarded ? '/home' : '/baseline');
      }
    }

    resolve().finally(() => {
      if (!cancelled) setChecking(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (checking || !route) {
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

  return <Redirect href={route} />;
}

