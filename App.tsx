import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Rubik_400Regular,
  Rubik_500Medium,
  Rubik_600SemiBold,
  Rubik_700Bold,
} from '@expo-google-fonts/rubik';

import Navigation from '@/navigation';
import { bootstrap, type BootstrapResult } from '@/lib/bootstrap';
import { colors } from '@/theme';
import { BackendBanner } from '@/components/BackendBanner';

export default function App() {
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
      <View style={{ flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brown} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Navigation onboarded={boot.onboarded} />
      <BackendBanner backend={boot.backend} warning={boot.warning} />
    </SafeAreaProvider>
  );
}
