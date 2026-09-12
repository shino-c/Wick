import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '@/theme';
import { Txt } from './base';
import { cameraAvailable } from '@/camera/CaptureCamera';
import { isDemoActive } from '@/lib/demoMode';

/**
 * A small, dismissible truth-teller.
 *
 * It matters during a demo that nobody — including us — mistakes simulated
 * biometrics for a live camera read, or a device-local store for a live
 * backend. This says which is which, once, and gets out of the way.
 *
 * In the zero-configuration simulation it stays silent: the demo is meant to
 * be walked through as if it were the real thing, so no "local demo store /
 * simulated camera" window floats over it. Once anything is configured the
 * banner behaves exactly as it always has.
 */
export function BackendBanner({
  backend,
  warning,
}: {
  backend: 'supabase' | 'local';
  warning: string | null;
}) {
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = React.useState(false);

  if (isDemoActive()) return null;

  const notes: string[] = [];
  if (warning) notes.push(warning);
  else if (backend === 'local') notes.push('Local demo store — no Supabase configured');
  if (!cameraAvailable) notes.push('Simulated biometrics — no native camera in this build');

  if (dismissed || notes.length === 0) return null;

  return (
    <Pressable
      onPress={() => setDismissed(true)}
      accessibilityRole="button"
      accessibilityLabel="Dismiss build info"
      style={{
        position: 'absolute',
        left: spacing(4),
        right: spacing(4),
        bottom: insets.bottom + spacing(20),
      }}
    >
      <View
        style={{
          backgroundColor: colors.night,
          borderRadius: radius.md,
          paddingVertical: spacing(2.5),
          paddingHorizontal: spacing(3.5),
        }}
      >
        <Txt v="small" color={colors.onNightSoft}>
          {notes.join('  ·  ')}
        </Txt>
      </View>
    </Pressable>
  );
}
