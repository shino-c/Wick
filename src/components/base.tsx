import { colors, radius, shadow, spacing, type } from '@/theme';
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
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/* ── Text ─────────────────────────────────────────────────────────── */

/* ── AppModal ─────────────────────── */

/**
 * The app's modal, and the reason every screen must use it rather than
 * react-native's `Modal` directly.
 *
 * React Native Web implements `Modal` with a *portal*: the overlay is mounted
 * into `document.body`, outside the app's element tree. That is invisible for a
 * full-screen phone app, and very visible in the browser preview, where the
 * phone is a frame in the middle of the page — the dimmer then covered the whole
 * browser and the dialog was drawn beside the device instead of inside it.
 *
 * The portal is not the problem in itself: on a real device there is one root,
 * so `body` and the app root are the same rectangle. The problem is inheriting
 * `document.body`'s box. So this: the overlay is sized to the app window and
 * positioned against the app's own root rather than against the page.
 *
 * ── Why `absolute`, not `fixed` ─────────────────────
 * A React portal keeps the DOM location of its parent, so the modal's node is a
 * child of whatever rendered it — the app's root view. That root is also the
 * nearest *positioned* ancestor, so `position: absolute; inset: 0` resolves to
 * the phone's frame, while `position: fixed` would resolve to the browser
 * viewport and put the overlay straight back over the whole page.
 */
export function AppModal({
  visible,
  onRequestClose,
  children,
  maxWidth = 420,
}: {
  visible: boolean;
  onRequestClose?: () => void;
  children: React.ReactNode;
  /** The widest the dialog itself may be, inside the frame. */
  maxWidth?: number;
}) {
  // Unmounting when hidden (rather than passing `visible={false}`) is what lets
  // the host view be skipped entirely, so a closed modal costs no layout at all.
  if (!visible) return null;

  return (
    <View style={styles.modalHost} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close dialog"
        onPress={onRequestClose}
        style={styles.modalOpaqueOverlay}
      />
      <View style={styles.modalFill} pointerEvents="box-none">
        <View style={[styles.modalCenter, { maxWidth }]} pointerEvents="box-none">
          {children}
        </View>
      </View>
    </View>
  );
}

/* ── Text ─────────────────────────── */

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
  // textTransform, not String(children).toUpperCase().
  //
  // JSX with any interpolation gives an ARRAY of children, and String() on an
  // array joins with commas — so `<Eyebrow>{n}s left</Eyebrow>` rendered as
  // "28,S LEFT". It also flattened nested elements to "[object Object]".
  // Uppercasing is presentation, so it belongs in the style.
  return (
    <Txt v="eyebrow" color={color} style={{ textTransform: 'uppercase' }}>
      {children}
    </Txt>
  );
}

/* ── Layout ───────────────────────────────────────────────────────── */

export function Screen({
  children,
  scroll = true,
  dark = false,
  padded = true,
  header,
  footer,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  dark?: boolean;
  padded?: boolean;
  /**
   * Pinned above the scroll area — where the shared brand bar goes.
   *
   * It has to sit outside the ScrollView, like `footer` does. A header that
   * scrolls away on one tab and not another is most of what made the tabs feel
   * like separate pages rather than one app.
   */
  header?: React.ReactNode;
  /** Pinned below the scroll area — where the shared tab bar goes. */
  footer?: React.ReactNode;
}) {
  const bg = dark ? colors.night : colors.cream;
  const inner = padded ? { padding: spacing(5), paddingBottom: spacing(12) } : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top']}>
      {header}
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

/**
 * Screen header. The circular back button and the wide-tracked centred title
 * follow the treatment on the baseline screen, so every stack screen in the app
 * has the same chrome rather than two competing header styles.
 */
/**
 * An emoji at an arbitrary size.
 *
 * `<Txt v="body" style={{ fontSize: 40 }}>` looked like it worked and did not:
 * the `body` token carries `lineHeight: 20`, so a 40px glyph was drawn into a
 * 20px line box and had its top and bottom sliced off. Every oversized icon in
 * the app was quietly cropped.
 *
 * Line height has to scale with the glyph. Emoji also sit lower in the em box
 * than Latin text, so 1.35 rather than the ~1.2 that would do for a letter, and
 * `includeFontPadding: false` on Android removes the extra ascent/descent that
 * would otherwise push it off-centre inside a circle.
 */
export function Emoji({
  children,
  size = 20,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  style?: TextStyle;
}) {
  return (
    <Text
      allowFontScaling={false}
      style={[
        {
          fontSize: size,
          lineHeight: Math.round(size * 1.35),
          textAlign: 'center',
          includeFontPadding: false,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * Screen header for the stack screens.
 *
 * The back button and the title are in-flow children of the same row
 * (`alignItems: 'center'`), so they always share one row and one vertical
 * centre — no wrapper insets to push the button below the page name.
 *
 * The title is a `flex: 1` child between two fixed 40px side slots, so it
 * stays horizontally centred whatever its text length.
 */
export function NavBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={styles.navBar}>
      <View style={styles.navSide}>
        {onBack && (
          <Pressable
            onPress={onBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7, transform: [{ scale: 0.96 }] }]}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.navTitle} numberOfLines={1}>{title.toUpperCase()}</Text>
      <View style={[styles.navSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  navBar: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing(4),
  },
  navSide: {
    width: 40,
  },
  navTitle: {
    flex: 1,
    color: colors.inkSoft,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 3,
    textAlign: 'center',
  },
 backButton: {
  width: 40,
  height: 40,
  borderRadius: 20,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.line,
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
  alignItems: 'center',
  justifyContent: 'center',
  transform: [{ translateX: -15}],
},

backIcon: {
  fontSize: 32,
  lineHeight: 34,
  color: colors.ink,
  fontWeight: '300',
  textAlign: 'center',
  transform: [{ translateX: -1 }],
},

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
  /* AppModal — sized to the app window, never to the browser page. */
  modalHost: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  /** The dimmer is part of the app tree, so it is clipped to the phone glass. */
  modalOpaqueOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  /** Centers the dialog both ways inside the full-screen host. */
  modalFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The dialog's own box — no flex, so it shrinks to its content and stays
   *  centred by the parent rather than stretching to any edge. */
  modalCenter: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: spacing(4),
  },
});
