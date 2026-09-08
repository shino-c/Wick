import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Slider from '@react-native-community/slider';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ITEMS } from '@/features/calibration/questionnaire';
import { markOnboarded } from '@/lib/bootstrap';
import { BASELINE_MIN_SCANS } from '@/services/ppgService';
import {
  addWorkloadItem,
  getBaseline,
  getCalendarConnections,
  latestSelfReport,
  listWorkloadItems,
  saveSelfReport,
  // syncCalendar,
} from '@/services/repository';
import { colors } from '@/theme';

// Palette comes from src/theme — the values there are the Figma swatches
// (#FFFBEB, #FDF1A9, #6B5038, #3D3A34). Keeping a second hardcoded set here is
// how two screens quietly drift apart.
const COLORS = {
  background: colors.cream,
  text: colors.ink,
  muted: colors.inkSoft,
  card: colors.surface,
  border: colors.line,
  brown: colors.brown,
  yellow: colors.yellow,
  yellowLight: colors.yellowWash,
  green: colors.calm,
};

export default function BaselineScreen() {
  const router = useRouter();
  const [stress, setStress] = useState(35);
  const [scanCount, setScanCount] = useState(0);
  const [questionnaireDone, setQuestionnaireDone] = useState(false);
  const [saving, setSaving] = useState(false);

  // Calendar sync state
  const [calendarModalVisible, setCalendarModalVisible] = useState(false);
  const [syncingProvider, setSyncingProvider] = useState<'google' | 'outlook' | null>(null);
  const [connectedProvider, setConnectedProvider] = useState<'google' | 'outlook' | null>(null);
  const [syncedItemsCount, setSyncedItemsCount] = useState(0);

  // Re-read on focus so returning from the questionnaire or a spot check shows
  // the updated state rather than a stale "not started".
  const refresh = React.useCallback(async () => {
    const [baseline, self, connections, items] = await Promise.all([
      getBaseline(),
      latestSelfReport(),
      getCalendarConnections(),
      listWorkloadItems(),
    ]);
    setScanCount(baseline.calibrationScans);
    setQuestionnaireDone(Boolean(self?.rawAnswers));

    const activeConn = connections.find((c) => c.connected);
    if (activeConn) {
      setConnectedProvider(activeConn.provider);
    }
    setSyncedItemsCount(items.length);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      refresh();
    }, [refresh])
  );

  const scansLeft = Math.max(0, BASELINE_MIN_SCANS - scanCount);
  const baselineReady = questionnaireDone && scansLeft === 0 && connectedProvider !== null;

  const handleContinue = async () => {
    if (!baselineReady) return;
    setSaving(true);
    // The slider is itself a self-report, so recording it means the first
    // dashboard read already has a real signal behind it.
    await saveSelfReport(Math.round(stress), null);
    await markOnboarded();
    setSaving(false);
    router.push('/home');
  };

  const handleSync = async (provider: 'google' | 'outlook') => {
    setSyncingProvider(provider);
    try {
      // Demo-only calendar data. Keep the real device sync below for restoring
      // the production flow after the presentation.
      const monday = new Date();
      monday.setHours(0, 0, 0, 0);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const demoEvents = [
        { title: 'Deep Work Session', day: 0, hour: 9, duration: 2, category: 'academic' as const, priority: 'high' as const },
        { title: 'Team Stand-up', day: 1, hour: 10, duration: 1, category: 'social' as const, priority: 'medium' as const },
        { title: 'Library Research', day: 2, hour: 14, duration: 2.5, category: 'academic' as const, priority: 'medium' as const },
        { title: 'Evening Run', day: 3, hour: 18, duration: 1, category: 'physical' as const, priority: 'low' as const },
        { title: 'Project Presentation', day: 4, hour: 11, duration: 1.5, category: 'academic' as const, priority: 'high' as const },
      ];
      const existingItems = await listWorkloadItems();
      if (!existingItems.some((item) => item.source === provider && item.title === demoEvents[0].title)) {
        for (const event of demoEvents) {
          const start = new Date(monday);
          start.setDate(monday.getDate() + event.day);
          start.setHours(event.hour, 0, 0, 0);
          const end = new Date(start.getTime() + event.duration * 60 * 60 * 1000);
          await addWorkloadItem({
            title: event.title,
            category: event.category,
            estimatedHours: event.duration,
            priority: event.priority,
            source: provider,
            scheduledStart: start.toISOString(),
            scheduledEnd: end.toISOString(),
          });
        }
      }
      const res = { addedCount: existingItems.filter((item) => item.source === provider).length || demoEvents.length };

      // Real device-calendar sync (restore this for production):
      // const res = await syncCalendar(provider);
      setConnectedProvider(provider);
      setSyncedItemsCount(res.addedCount);
      setCalendarModalVisible(false);
    } catch (e) {
      console.warn('Calendar sync error', e);
    } finally {
      setSyncingProvider(null);
    }
  };

  const getStressState = () => {
    if (stress < 25) {
      return {
        label: 'Gently Centered',
        background: '#EFF6EB',
        color: '#6A994E',
      };
    }

    if (stress < 60) {
      return {
        label: 'Mildly Tense',
        background: '#FEF2A7',
        color: '#554128',
      };
    }

    return {
      label: 'Elevated Load',
      background: '#FDF0ED',
      color: '#E07A5F',
    };
  };

  const stressState = getStressState();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={COLORS.background}
      />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              }
            }}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>

          <Text style={styles.setupText}>SET UP</Text>

          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Title */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>Set Your Baseline</Text>

            <Text style={styles.subtitle}>
              A gentle space tailored to your daily rhythm. Tell us how you are
              feeling today.
            </Text>
          </View>

          {/* Stress Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>
                How stressed are you feeling?
              </Text>

              <Text style={styles.sparkle}>✦</Text>
            </View>

            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.stressBadge,
                  { backgroundColor: stressState.background },
                ]}
              >
                <Text
                  style={[
                    styles.stressBadgeText,
                    { color: stressState.color },
                  ]}
                >
                  {stressState.label}
                </Text>
              </View>
            </View>

            <View style={styles.sliderContainer}>
              <View style={styles.sliderBackground}>
                <View
                  style={[
                    styles.sliderGreen,
                    { width: `${stress}%` },
                  ]}
                />
              </View>

              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={100}
                value={stress}
                onValueChange={setStress}
                minimumTrackTintColor="transparent"
                maximumTrackTintColor="transparent"
                thumbTintColor="#2D2723"
              />
            </View>

            <View style={styles.sliderLabels}>
              <View style={styles.sliderLabelLeft}>
                <Text style={styles.emoji}>🌱</Text>
                <Text style={styles.labelText}>Relaxed</Text>
              </View>

              <View style={styles.sliderLabelRight}>
                <Text style={styles.labelText}>Very stressed</Text>
                <Text style={styles.emoji}>⚡</Text>
              </View>
            </View>
          </View>

          {/* Assessment Card */}
          <View style={styles.card}>
            <View style={styles.assessmentRow}>
              <View style={styles.assessmentLeft}>
                <View style={[styles.checkCircle, !questionnaireDone && { backgroundColor: '#F1EDE4' }]}>
                  <Text style={[styles.checkIcon, !questionnaireDone && { color: '#A79E93' }]}>
                    {questionnaireDone ? '✓' : '○'}
                  </Text>
                </View>

                <View style={styles.assessmentText}>
                  <Text style={styles.assessmentTitle}>
                    Personal Baseline{'\n'}Assessment
                  </Text>

                  <Text style={styles.assessmentSubtitle}>
                    {ITEMS.length}-Item Perceived Stress{questionnaireDone ? ' (Completed)' : ' (Not started)'}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={() => router.push('/questionnaire')}
                style={({ pressed }) => [
                  styles.recalibrateButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.recalibrateText}>{questionnaireDone ? 'Recalibrate' : 'Start'}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </View>
          </View>

          {/* PPG Card */}
          <View style={styles.card}>
            <View style={styles.ppgHeader}>
              <View style={styles.pointIcon}>
                <Text style={styles.pointEmoji}>👉</Text>
              </View>

              <View style={styles.ppgText}>
                <Text style={styles.ppgTitle}>Finger-PPG Spot Check</Text>

                <Text style={styles.ppgSubtitle}>
                  Place your index fingertip{'\n'}
                  over rear camera + flash · 1min check
                </Text>
              </View>
            </View>

            {/* Cold start made visible: stress detection needs three scans
                before there is a baseline to compare against. */}
            <View style={styles.progressRow}>
              <Text style={styles.progressLabel}>
                {scanCount}/{BASELINE_MIN_SCANS} scans
              </Text>
              <Text style={[styles.progressHint, { color: scansLeft > 0 ? '#B4892F' : COLORS.green }]}>
                {scansLeft > 0 ? `${scansLeft} more to unlock stress detection` : 'Baseline active'}
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${(Math.min(scanCount, BASELINE_MIN_SCANS) / BASELINE_MIN_SCANS) * 100}%`,
                    backgroundColor: scansLeft > 0 ? COLORS.yellow : COLORS.green,
                  },
                ]}
              />
            </View>

            <Pressable
              onPress={() => router.push('/spot-check')}
              style={({ pressed }) => [
                styles.yellowButton,
                pressed && styles.pressedButton,
              ]}
            >
              <Text style={styles.yellowButtonText}>
                Start Spot Check
              </Text>
            </Pressable>
          </View>

          {/* Calendar Card */}
          <View style={styles.card}>
            <View style={styles.calendarIllustration}>
              <View style={styles.circleOne} />
              <View style={styles.circleTwo} />

              <View style={styles.illustrationIcons}>
                <Text style={styles.calendarIcon}>▣</Text>
                <Text style={styles.leafIcon}>♧</Text>
              </View>
            </View>

            <View style={styles.calendarText}>
              <View style={styles.calendarTitleRow}>
                <Text style={styles.calendarTitle}>Sync Your Calendar</Text>
                {connectedProvider && (
                  <View style={styles.connectedPill}>
                    <Text style={styles.connectedPillText}>
                      {connectedProvider === 'google' ? 'Google' : 'Outlook'} Active
                    </Text>
                  </View>
                )}
              </View>

              <Text style={styles.calendarDescription}>
                {connectedProvider
                  ? `${syncedItemsCount} calendar events mapped into your load schedule. You can sync again from this screen.`
                  : "We'll quietly scan your daily agenda to automatically schedule brief, nourishing breathing sessions in your free windows."}
              </Text>
            </View>

            {connectedProvider ? (
              <Pressable
                onPress={() => setCalendarModalVisible(true)}
                style={({ pressed }) => [styles.yellowButton, pressed && styles.pressedButton]}
              >
                <Text style={styles.yellowButtonText}>Re-sync Calendar</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setCalendarModalVisible(true)}
                style={({ pressed }) => [
                  styles.yellowButton,
                  styles.connectButton,
                  pressed && styles.pressedButton,
                ]}
              >
                <Text style={styles.lockIcon}>▣</Text>
                <Text style={styles.yellowButtonText}>
                  Connect Calendar
                </Text>
              </Pressable>
            )}
          </View>

          {/* Bottom spacing for fixed button */}
          <View style={{ height: 110 }} />
        </ScrollView>

        {/* Bottom CTA */}
        <View style={styles.bottomContainer}>
          <Pressable
            onPress={handleContinue}
            disabled={saving || !baselineReady}
            style={({ pressed }) => [
              styles.continueButton,
              !baselineReady && styles.disabledContinueButton,
              pressed && styles.pressedContinue,
            ]}
          >
            <Text style={styles.continueText}>
              {saving ? 'Saving…' : baselineReady ? 'Continue to Dashboard' : 'Complete all baseline steps'}
            </Text>

            <Text style={styles.arrow}>→</Text>
          </Pressable>

          <View style={styles.homeIndicator} />
        </View>

        {/* Calendar Connect Modal */}
        <Modal
          visible={calendarModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCalendarModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Connect Your Calendar</Text>
                <Pressable
                  onPress={() => setCalendarModalVisible(false)}
                  style={({ pressed }) => [styles.modalClose, pressed && styles.pressed]}
                >
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <Text style={styles.modalSubtitle}>
                Link your student calendar to automatically build your categorized load map and weekly workload capacity:
              </Text>

              {/* Google Calendar Option */}
              <Pressable
                disabled={syncingProvider !== null}
                onPress={() => handleSync('google')}
                style={({ pressed }) => [
                  styles.providerOption,
                  connectedProvider === 'google' && styles.providerActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.providerIconContainer, { backgroundColor: '#EBF4FF' }]}>
                  <Text style={{ fontSize: 22 }}>🗓️</Text>
                </View>
                <View style={styles.providerInfo}>
                  <Text style={styles.providerName}>Google Calendar</Text>
                  <Text style={styles.providerDesc}>Lectures, lab prep, study blocks</Text>
                </View>
                {syncingProvider === 'google' ? (
                  <ActivityIndicator size="small" color={COLORS.brown} />
                ) : connectedProvider === 'google' ? (
                  <Text style={styles.providerCheck}>✓</Text>
                ) : (
                  <Text style={styles.providerArrow}>→</Text>
                )}
              </Pressable>

              {/* Outlook Calendar Option */}
              <Pressable
                disabled={syncingProvider !== null}
                onPress={() => handleSync('outlook')}
                style={({ pressed }) => [
                  styles.providerOption,
                  connectedProvider === 'outlook' && styles.providerActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.providerIconContainer, { backgroundColor: '#EFF6FF' }]}>
                  <Text style={{ fontSize: 22 }}>📅</Text>
                </View>
                <View style={styles.providerInfo}>
                  <Text style={styles.providerName}>Microsoft Outlook</Text>
                  <Text style={styles.providerDesc}>Office 365, seminars, office hours</Text>
                </View>
                {syncingProvider === 'outlook' ? (
                  <ActivityIndicator size="small" color={COLORS.brown} />
                ) : connectedProvider === 'outlook' ? (
                  <Text style={styles.providerCheck}>✓</Text>
                ) : (
                  <Text style={styles.providerArrow}>→</Text>
                )}
              </Pressable>

            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { height: 58, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EDE8E1', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  backIcon: { fontSize: 32, lineHeight: 34, color: COLORS.text, fontWeight: '300' },
  setupText: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#8E877F', fontSize: 13, fontWeight: '700', letterSpacing: 3 },
  headerSpacer: { width: 40 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 12 },
  titleSection: { marginBottom: 16 },
  title: { color: COLORS.text, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.7 },
  subtitle: { marginTop: 6, color: COLORS.muted, fontSize: 15, lineHeight: 23 },
  card: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 28, padding: 20, marginBottom: 16, shadowColor: '#503C28', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { flex: 1, color: COLORS.text, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  sparkle: { color: '#B2ABA2', fontSize: 23 },
  badgeRow: { alignItems: 'flex-end', paddingRight: 14, marginBottom: 8 },
  stressBadge: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18 },
  stressBadgeText: { fontSize: 13, fontWeight: '700' },
  sliderContainer: { height: 48, justifyContent: 'center', position: 'relative' },
  sliderBackground: { position: 'absolute', left: 4, right: 4, height: 8, borderRadius: 8, overflow: 'hidden', flexDirection: 'row', backgroundColor: '#F59797' },
  sliderGreen: { height: '100%', backgroundColor: '#CEEAD6' },
  slider: { width: '100%', height: 48 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 2 },
  sliderLabelLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sliderLabelRight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  emoji: { fontSize: 16 },
  labelText: { color: '#605B54', fontSize: 14, fontWeight: '500' },
  assessmentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  assessmentLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  checkCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center' },
  checkIcon: { color: '#16A34A', fontSize: 21, fontWeight: '800' },
  assessmentText: { flex: 1 },
  assessmentTitle: { color: COLORS.text, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  assessmentSubtitle: { marginTop: 3, color: '#8C847C', fontSize: 12, lineHeight: 16 },
  recalibrateButton: { flexDirection: 'row', alignItems: 'center' },
  recalibrateText: { color: COLORS.green, fontSize: 14, fontWeight: '700' },
  chevron: { color: COLORS.green, fontSize: 23, marginLeft: 2 },
  ppgHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 16 },
  pointIcon: { width: 44, height: 44, borderRadius: 16, backgroundColor: COLORS.yellowLight, alignItems: 'center', justifyContent: 'center' },
  pointEmoji: { fontSize: 22 },
  ppgText: { flex: 1 },
  ppgTitle: { color: COLORS.text, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  ppgSubtitle: { marginTop: 4, color: '#80776F', fontSize: 13, lineHeight: 18 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progressLabel: { color: '#8C847C', fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  progressHint: { fontSize: 12, fontWeight: '600' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#F1EDE4', overflow: 'hidden', marginBottom: 16 },
  progressFill: { height: '100%', borderRadius: 3 },
  yellowButton: { width: '100%', height: 48, borderRadius: 16, backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center' },
  yellowButtonText: { color: '#3D2E1E', fontSize: 15, fontWeight: '700' },
  calendarIllustration: { width: '100%', height: 80, borderRadius: 16, backgroundColor: '#FAF6E8', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  circleOne: { position: 'absolute', left: 20, width: 64, height: 64, borderRadius: 32, backgroundColor: '#F5EEDB' },
  circleTwo: { position: 'absolute', right: 28, width: 48, height: 48, borderRadius: 24, backgroundColor: '#EBF4EE' },
  illustrationIcons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  calendarIcon: { color: '#3D2E1E', fontSize: 27 },
  leafIcon: { color: '#3D2E1E', fontSize: 25 },
  calendarText: { marginBottom: 16 },
  calendarTitle: { color: COLORS.text, fontSize: 17, lineHeight: 22, fontWeight: '700', marginBottom: 4 },
  calendarDescription: { color: '#7D746D', fontSize: 13, lineHeight: 19 },
  connectButton: { flexDirection: 'row', gap: 8 },
  lockIcon: { color: '#3D2E1E', fontSize: 16 },
  bottomContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 12, backgroundColor: COLORS.background },
  continueButton: { width: '100%', height: 56, borderRadius: 30, backgroundColor: COLORS.brown, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#50371E', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  disabledContinueButton: { opacity: 0.45 },
  continueText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  arrow: { color: '#FFFFFF', fontSize: 22 },
  homeIndicator: { alignSelf: 'center', width: 128, height: 4, borderRadius: 4, backgroundColor: '#C8C1B7', marginTop: 14 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  pressedButton: { backgroundColor: '#FEEA85', transform: [{ scale: 0.98 }] },
  pressedContinue: { backgroundColor: '#523E2C', transform: [{ scale: 0.98 }] },
  calendarTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  connectedPill: { backgroundColor: '#DCFCE7', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  connectedPillText: { color: '#16A34A', fontSize: 11, fontWeight: '700' },
  connectedActionsRow: { flexDirection: 'row', gap: 10 },
  connectedButtonHalf: { flex: 1 },
  secondaryButton: { flex: 1, height: 48, borderRadius: 16, backgroundColor: '#FAF6E8', borderWidth: 1, borderColor: '#EDE8E1', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: COLORS.brown, fontSize: 14, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 36 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  modalSubtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 20, marginBottom: 20 },
  modalClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F5F2EC', alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: COLORS.muted, fontSize: 15, fontWeight: '700' },
  providerOption: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 18, borderWidth: 1.5, borderColor: '#EDE7D6', backgroundColor: '#FAFAF8', marginBottom: 12 },
  providerActive: { borderColor: COLORS.green, backgroundColor: '#F2F9F5' },
  providerIconContainer: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  providerInfo: { flex: 1 },
  providerName: { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  providerDesc: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  providerCheck: { color: '#16A34A', fontSize: 18, fontWeight: '800' },
  providerArrow: { color: COLORS.muted, fontSize: 18 },
  manualEntryLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 14 },
  manualEntryLinkText: { color: COLORS.brown, fontSize: 14, fontWeight: '600' },
  inputLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6, marginTop: 12 },
  textInput: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#EDE7D6', paddingHorizontal: 14, color: COLORS.text, fontSize: 15, backgroundColor: '#FAFAF8' },
  categoryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: '#F5F2EC', borderWidth: 1, borderColor: '#EAE5DB' },
  categoryChipSelected: { backgroundColor: COLORS.yellow, borderColor: '#ECCB49' },
  categoryChipText: { color: '#6E6A61', fontSize: 12, fontWeight: '600' },
  categoryChipTextSelected: { color: '#3D2E1E', fontWeight: '700' },
  rowTwoCols: { flexDirection: 'row', alignItems: 'center' },
  priorityGroup: { flexDirection: 'row', height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#EDE7D6', overflow: 'hidden' },
  priorityButton: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAF8' },
  priorityButtonSelected: { backgroundColor: COLORS.brown },
  priorityText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  priorityTextSelected: { color: '#FFFFFF', fontWeight: '800' },
  saveTaskButton: { height: 50, borderRadius: 25, backgroundColor: COLORS.brown, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  saveTaskButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  disabledButton: { opacity: 0.5 },
});
