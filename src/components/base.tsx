import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, type } from '@/theme';

/* ── Text ─────────────────────────────────────────────────────────── */

type Variant = keyof typeof type;
type TxtProps = TextProps & { v?: Variant; color?: string; center?: boolean };

export function Txt({ v = 'body', color = colors.ink, center, style, ...rest }: TxtProps) {
  return (
    <Text
      {...rest}
      style={[type[v], { color }, center && { textAlign: 'center' }, style]}
    />
  );
}

export function Eyebrow({ children, color = colors.inkFaint }: { children: React.ReactNode; color?: string }) {
  return (
    <Txt v="eyebrow" color={color}>
      {String(children).toUpperCase()}
    </Txt>
  );
}

/* ── Layout ───────────────────────────────────────────────────────── */

export function Screen({
  children,
  scroll = true,
  dark = false,
  padded = true,
  footer,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  dark?: boolean;
  padded?: boolean;
  /** Pinned below the scroll area — where the shared tab bar goes. */
  footer?: React.ReactNode;
}) {
  const bg = dark ? colors.night : colors.cream;
  const inner = padded ? { padding: spacing(5), paddingBottom: spacing(12) } : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={inner}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

export function Card({ style, children, ...rest }: ViewProps & { children: React.ReactNode }) {
  return (
    <View {...rest} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function Row({ style, children, gap = 2, ...rest }: ViewProps & { children: React.ReactNode; gap?: number }) {
  return (
    <View {...rest} style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing(gap) }, style]}>
      {children}
    </View>
  );
}

export function Spacer({ h = 3 }: { h?: number }) {
  return <View style={{ height: spacing(h) }} />;
}

export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 1, backgroundColor: colors.line, marginVertical: spacing(3) }, style]} />;
}

/* ── Controls ─────────────────────────────────────────────────────── */

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'soft' | 'ghost' | 'danger' | 'night';
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  style?: ViewStyle;
}) {
  const palette = {
    primary: { bg: colors.brown, fg: '#FFFDF5', border: 'transparent' },
    soft: { bg: colors.yellow, fg: colors.brown, border: 'transparent' },
    ghost: { bg: 'transparent', fg: colors.brown, border: colors.lineStrong },
    danger: { bg: colors.alertWash, fg: colors.alert, border: 'transparent' },
    night: { bg: colors.nightSoft, fg: colors.onNight, border: colors.nightLine },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <Txt v="heading" color={palette.fg}>
          {icon ? `${icon}  ${label}` : label}
        </Txt>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  tone,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: { fg: string; bg: string };
}) {
  const fg = tone?.fg ?? (active ? colors.brown : colors.inkSoft);
  const bg = tone?.bg ?? (active ? colors.yellow : colors.surface);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: bg, borderColor: active ? colors.yellowDeep : colors.line },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Txt v="small" color={fg} style={{ fontFamily: type.heading.fontFamily, fontSize: 12 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function Badge({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Txt v="eyebrow" color={fg}>
        {label.toUpperCase()}
      </Txt>
    </View>
  );
}

export function Bar({ pct, color = colors.brown, track = colors.line, height = 6 }: { pct: number; color?: string; track?: string; height?: number }) {
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/* ── Screen header used on every stack screen ─────────────────────── */

export function NavBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginBottom: spacing(4) }}>
      <View style={{ width: 40 }}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
            <Txt v="title" color={colors.ink}>
              ‹
            </Txt>
          </Pressable>
        )}
      </View>
      <Eyebrow color={colors.inkSoft}>{title}</Eyebrow>
      <View style={{ width: 40, alignItems: 'flex-end' }}>{right}</View>
    </Row>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing(4),
    ...shadow.card,
  },
  button: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(5),
  },
  chip: {
    paddingHorizontal: spacing(3),
    paddingVertical: spacing(2),
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badge: {
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1.5),
    borderRadius: radius.pill,
  },
});
