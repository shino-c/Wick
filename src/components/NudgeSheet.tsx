/**
 * NudgeSheet — the one place a nudge is ever shown.
 *
 * A small bottom sheet rather than a centre-screen alert, on purpose. An alert
 * seizes the screen and makes "no" the effortful option; a sheet sits under
 * what the user was already looking at, and tapping away from it is a complete,
 * respectable answer. That asymmetry matters more here than anywhere else in
 * the app: this is the only component that speaks before it is spoken to.
 *
 * Every path out records an outcome, including the silent ones. A nudge the
 * user swiped past is data — treating only explicit taps as signal would make
 * the acceptance rate look far better than it is.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Nudge, NudgeAction, NudgeKind } from '@/data/types';
import { phraseNudge } from '@/services/aiService';
import { acceptNudge, dismissNudge, snoozeNudge } from '@/services/nudgeService';
import { colors, font, radius, shadow, spacing } from '@/theme';

const ICON: Record<NudgeKind, keyof typeof Ionicons.glyphMap> = {
  desk: 'timer-outline',
  recovery: 'leaf-outline',
  challenge: 'people-outline',
  spot_check: 'pulse-outline',
};

/** Muted on purpose — a nudge is an offer, not an alarm. */
const ACCENT: Record<NudgeKind, { fg: string; bg: string }> = {
  desk: { fg: colors.brown, bg: colors.yellowWash },
  recovery: { fg: colors.calm, bg: colors.calmWash },
  challenge: { fg: colors.brownSoft, bg: colors.yellowWash },
  spot_check: { fg: colors.warn, bg: colors.warnWash },
};

export function NudgeSheet({
  nudge,
  onClose,
}: {
  nudge: Nudge | null;
  onClose: () => void;
}) {
  const router = useRouter();
  // Keyed by nudge id rather than cleared on change: a rewrite that lands
  // after the sheet has already moved on to a different nudge must not be
  // painted over it.
  const [copy, setCopy] = React.useState<{
    nudgeId: string;
    title: string;
    body: string;
  } | null>(null);

  // The warm rewrite arrives behind the sheet, if it arrives at all. The plain
  // wording is on screen the whole time, so nothing ever waits on the network.
  React.useEffect(() => {
    if (!nudge) return;
    let alive = true;
    phraseNudge(nudge)
      .then((result) => {
        if (alive && result) setCopy({ nudgeId: nudge.id, ...result });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [nudge]);

  if (!nudge) return null;

  const accent = ACCENT[nudge.kind];
  const fresh = copy?.nudgeId === nudge.id ? copy : null;
  const title = fresh?.title ?? nudge.title;
  const body = fresh?.body ?? nudge.body;

  const go = (action: NudgeAction) => {
    acceptNudge(nudge).catch(() => {});
    onClose();
    router.push({ pathname: action.href as never, params: action.params as never });
  };

  const later = () => {
    snoozeNudge(nudge).catch(() => {});
    onClose();
  };

  const notNow = () => {
    dismissNudge(nudge).catch(() => {});
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={later}>
      {/* Tapping the backdrop is a snooze, not a dismissal. Someone who taps
          away has not rejected the idea — they have declined to deal with it
          now, and a 24-hour silence would be reading far too much into it. */}
      <Pressable style={styles.backdrop} onPress={later}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <View style={[styles.iconWrap, { backgroundColor: accent.bg }]}>
              <Ionicons name={ICON[nudge.kind]} size={20} color={accent.fg} />
            </View>
            <Text style={styles.title}>{title}</Text>
          </View>

          <Text style={styles.body}>{body}</Text>

          {/* The evidence line, verbatim. A nudge that cannot show its working
              is indistinguishable from a guess, and the user has no way to tell
              a good one from a bad one without it. */}
          <View style={styles.evidenceRow}>
            <Ionicons name="information-circle-outline" size={13} color={colors.inkFaint} />
            <Text style={styles.evidence}>{nudge.evidence}</Text>
          </View>

          <Pressable
            onPress={() => go(nudge.action)}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>{nudge.action.label}</Text>
          </Pressable>

          {nudge.secondaryAction && (
            <Pressable
              onPress={() => go(nudge.secondaryAction!)}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>{nudge.secondaryAction.label}</Text>
            </Pressable>
          )}

          <View style={styles.footer}>
            <Pressable onPress={later} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
              <Text style={styles.quiet}>Later</Text>
            </Pressable>
            <Pressable onPress={notNow} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
              <Text style={styles.quiet}>Not today</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(34, 32, 28, 0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing(5),
    paddingTop: spacing(3),
    paddingBottom: spacing(8),
    ...shadow.card,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.lineStrong,
    marginBottom: spacing(4),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontFamily: font.semibold, fontSize: 18, color: colors.ink },
  body: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSoft,
    marginTop: spacing(3),
  },
  evidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1.5),
    marginTop: spacing(3),
  },
  evidence: { flex: 1, fontFamily: font.regular, fontSize: 11, color: colors.inkFaint },
  primary: {
    marginTop: spacing(5),
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.brown,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: font.medium, fontSize: 15, color: colors.cream },
  secondary: {
    marginTop: spacing(2),
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.yellowWash,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontFamily: font.medium, fontSize: 14, color: colors.brown },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing(4),
    paddingHorizontal: spacing(2),
  },
  quiet: { fontFamily: font.regular, fontSize: 13, color: colors.inkFaint },
  pressed: { opacity: 0.65 },
});

export default NudgeSheet;
