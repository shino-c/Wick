import { useTheme } from '@/hooks/use-theme';
import { SymbolView } from 'expo-symbols';
import { PropsWithChildren, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Collapsible({ children, title }: PropsWithChildren & { title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();

  return (
    <ThemedView>
    <View>
      <Pressable
        style={({ pressed }) => [styles.heading, pressed && styles.pressedHeading]}
        onPress={() => setIsOpen((value) => !value)}>
        <ThemedView type="backgroundElement" style={styles.button}>
        <View style={styles.button}>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={14}
            weight="bold"
            tintColor={theme.text}
            style={{ transform: [{ rotate: isOpen ? '-90deg' : '90deg' }] }}
          />
        </ThemedView>
        </View>

        <ThemedText type="small">{title}</ThemedText>
        <Text style={{ fontSize: 13, color: theme.text }}>{title}</Text>
      </Pressable>
      {isOpen && (
        <Animated.View entering={FadeIn.duration(200)}>
          <ThemedView type="backgroundElement" style={styles.content}>
          <View style={styles.content}>
            {children}
          </ThemedView>
          </View>
        </Animated.View>
      )}
    </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  pressedHeading: {
    opacity: 0.7,
  },
  button: {
    width: Spacing.four,
    height: Spacing.four,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    marginTop: Spacing.three,
    borderRadius: Spacing.three,
    marginLeft: Spacing.four,
    padding: Spacing.four,
  },
});

