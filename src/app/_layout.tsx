import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Rubik_400Regular,
  Rubik_500Medium,
  Rubik_600SemiBold,
  Rubik_700Bold,
} from '@expo-google-fonts/rubik';

import { bootstrap, type BootstrapResult } from '@/lib/bootstrap';
import { colors } from '@/theme';
import { BackendBanner } from '@/components/BackendBanner';
import { NotificationProvider } from '@/components/NotificationProvider';

/**
 * Root layout. Holds the two things every route needs before it can render:
 * the Rubik font family, and the one-time bootstrap that decides whether we're
 * talking to Supabase or the local demo store.
 *
 * Routing itself is expo-router's file tree — the tab bar lives in
 * src/components/bottombar.tsx and is rendered per-screen.
 */
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Rubik_400Regular,
    Rubik_500Medium,
    Rubik_600SemiBold,
    Rubik_700Bold,
  });
  const [boot, setBoot] = React.useState<BootstrapResult | null>(null);

  React.useEffect(() => {
    bootstrap().then(setBoot);
  }, []);

  if (!fontsLoaded || !boot) {
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

  return (
    <SafeAreaProvider>
      <NotificationProvider>
        <StatusBar style="dark" />
        <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.cream },
        }}
      >
        {/* Tabs must not animate.
            These are siblings reached with router.replace, not a hierarchy, so
            the default push transition slid one "page" over another and made
            switching tabs feel like leaving the app you were in. With no
            animation the pinned header and tab bar stay put and only the
            content between them changes, which is what a tab bar promises. */}
        <Stack.Screen name="home" options={{ animation: 'none' }} />
        <Stack.Screen name="desk" options={{ animation: 'none' }} />
        <Stack.Screen name="social" options={{ animation: 'none' }} />

        {/* A focus session must not be swipeable-away mid-reading, and the
            enforced pause depends on it. */}
        <Stack.Screen name="session" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="summary" options={{ gestureEnabled: false }} />
        </Stack>
        <BackendBanner backend={boot.backend} warning={boot.warning} />
      </NotificationProvider>
    </SafeAreaProvider>
  );
}
