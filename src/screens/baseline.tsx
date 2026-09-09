import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';

import Slider from '@react-native-community/slider';
import { useFocusEffect, useRouter } from 'expo-router';

import { NavBar, Screen } from '@/components/base';
import { ITEMS } from '@/features/calibration/questionnaire';
import { markOnboarded } from '@/lib/bootstrap';
import { supabase } from '@/lib/supabaseClient';
import {
  connectCalendar,
  getCalendarConnections,
  getCalendarPermissionStatus,
  syncCalendarEvents,
} from '@/services/calendarSync';
import { BASELINE_MIN_SCANS } from '@/services/ppgService';
import {
  getBaseline,
  hasQuestionnaireAnswers,
  latestSelfReport,
  saveSelfReport,
  syncAndAnalyzeCalendar,
} from '@/services/repository';
import { colors } from '@/theme';
type CalendarConnection = {
  provider: string;
  connected: boolean;
};

const COLORS = {
  background: colors.cream,
  text: colors.ink,
  muted: colors.inkSoft,
  card: colors.surface,
  border: colors.line,
  brown: colors.brown,
  yellow: colors.yellow,
  yellowLight: colors.yellowWash,
  orangeLight: '#F8EEDE',
  green: colors.calm,
};
export default function BaselineScreen() {
  const router = useRouter();
  const [stress, setStress] = useState(45);
  const [scanCount, setScanCount] = useState(0);
  const [questionnaireDone, setQuestionnaireDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [calendarConnections, setCalendarConnections] = useState<CalendarConnection[]>([]);
  const [calendarPermission, setCalendarPermission] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  const [syncing, setSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  const refresh = React.useCallback(async () => {
  const [baseline, self, questionnaireCompleted, connections] = await Promise.all([
    getBaseline(),
    latestSelfReport(),
    hasQuestionnaireAnswers(),
    getCalendarConnections(),
  ]);

  const permissionStatus = await getCalendarPermissionStatus();

  setScanCount(baseline.calibrationScans);
  setQuestionnaireDone(questionnaireCompleted);

  // Restore the latest perceived-stress value.
  if (self?.score != null) {
    setStress(Number(self.score));
  }

  setCalendarConnections(connections);
  setCalendarPermission(permissionStatus);
}, []);

  useFocusEffect(
    React.useCallback(() => {
      refresh();
    }, [refresh])
  );

  const scansLeft = Math.max(0, BASELINE_MIN_SCANS - scanCount);

  const handleConnectCalendar = async () => {
    setSyncing(true);
    try {
      await connectCalendar();
      const syncRes = await syncCalendarEvents();
      await refresh();
      if (syncRes.error) {
        setSyncInfo('Calendar connected (demo mode/limited on this device)');
      } else {
        const total = (syncRes.saved || 0) + (syncRes.existing || 0);
        setSyncInfo(`${total} task(s) found for this week`);
      }
    } catch (error) {
      console.error('Calendar connection error:', error);
      Alert.alert('Error', 'Failed to connect calendar. Please check permissions.');
    } finally {
      setSyncing(false);
    }
  };



  const handleContinue = async () => {
    setSaving(true);
    try {
      await saveSelfReport(Math.round(stress), null);
      // Run AI workload analysis on current week calendar events before going to dashboard
      await syncAndAnalyzeCalendar();
      await markOnboarded();
      router.replace('/home');
    } catch (error) {
      console.error('Baseline setup save error:', error);
      Alert.alert(
        'Could not save setup',
        'Please check your connection and try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  /**
   * Back = leave setup entirely. Signing out (not router.back) is deliberate:
   * baseline setup is per signed-in user, so stepping out of it means the
   * session is over and the next entry has to sign in again — which re-runs
   * bootstrap() and routes this user back here, data intact, because every
   * step below is already persisted under their Supabase user id.
   */
  const handleBackToLogin = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  // Continue unlocks only when every baseline step is complete. Calendar sync
  // is part of the setup: the dashboard's AI analysis is built from it.
  const calendarConnected = calendarConnections.some(
    (c) => c.provider === 'device' && c.connected
  );

  const setupComplete =
    questionnaireDone &&
    scansLeft === 0 &&
    calendarConnected;



  const getStressState = () => {
    if (stress < 25) {
      return { label: 'Gently Centered', background: '#EFF6EB', color: '#6A994E' };
    }
    if (stress < 60) {
      return { label: 'Mildly Tense', background: '#FEF2A7', color: '#554128' };
    }
    return { label: 'Elevated Load', background: '#FDF0ED', color: '#E07A5F' };
  };

  const stressState = getStressState();

  return (
    <Screen
      header={<NavBar title="SET UP" onBack={handleBackToLogin} />}
      footer={
        <View style={styles.bottomContainer}>
          <Pressable
            onPress={handleContinue}
            disabled={saving || !setupComplete}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.pressed,
              (saving || !setupComplete) && styles.disabledContinue,
            ]}
          >
            <Text style={styles.continueText}>
              {saving ? 'Saving…' : 'Continue to Dashboard'}
            </Text>
            <Text style={styles.arrow}>→</Text>
          </Pressable>
          <View style={styles.homeIndicator} />
        </View>
      }
    >
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={styles.titleSection}>
        <Text style={styles.title}>Set Your Baseline</Text>
        <Text style={styles.subtitle}>
          A gentle space tailored to your daily rhythm. Tell us how you are feeling today.
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>How stressed are you feeling?</Text>
          <Text style={styles.sparkle}>✦</Text>
        </View>
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.stressBadge,
              {
                backgroundColor: stressState.background,
                left: `${Math.min(Math.max(stress, 5), 95)}%`,
              },
            ]}
          >
            <Text style={[styles.stressBadgeText, { color: stressState.color }]}>
              {stressState.label}
            </Text>
          </View>
        </View>
        <View style={styles.sliderContainer}>
          <View style={styles.sliderBackground}>
            <View style={[styles.sliderGreen, { width: `${stress}%` }]} />
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

      <View style={styles.card}>
        <View style={styles.assessmentRow}>
          <View style={styles.assessmentLeft}>
            <View style={[styles.checkCircle, !questionnaireDone && { backgroundColor: '#F1EDE4' }]}>
              <Text style={[styles.checkIcon, !questionnaireDone && { color: '#A79E93' }]}>
                {questionnaireDone ? '✓' : '○'}
              </Text>
            </View>
            <View style={styles.assessmentText}>
              <Text style={styles.assessmentTitle}>Personal Baseline{'\n'}Assessment</Text>
              <Text style={styles.assessmentSubtitle}>
                {ITEMS.length}-Item Perceived Stress{questionnaireDone ? ' (Completed)' : ' (Not started)'}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/questionnaire')}
            style={({ pressed }) => [styles.recalibrateButton, pressed && styles.pressed]}
          >
            <Text style={styles.recalibrateText}>{questionnaireDone ? 'Recalibrate' : 'Start'}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.ppgHeader}>
          <View style={styles.pointIcon}>
            <Text style={styles.pointEmoji}>👉</Text>
          </View>
          <View style={styles.ppgText}>
            <Text style={styles.ppgTitle}>Finger-PPG Spot Check</Text>
            <Text style={styles.ppgSubtitle}>
              Place your index fingertip{'\n'}over rear camera + flash · 1min check
            </Text>
          </View>
        </View>
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
          style={({ pressed }) => [styles.yellowButton, pressed && styles.pressedButton]}
        >
          <Text style={styles.yellowButtonText}>Start Spot Check</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.ppgHeader}>
          <View style={[styles.pointIcon, { backgroundColor: COLORS.orangeLight }]}>
            <Text style={styles.pointEmoji}>📅</Text>
          </View>
          <View style={styles.ppgText}>
            <Text style={styles.ppgTitle}>Sync Your Calendar</Text>
            <Text style={styles.ppgSubtitle}>
              Connect your calendar{'\n'}
              so Wick can understand your workload
            </Text>
          </View>
        </View>

        {calendarPermission === 'denied' ? (
          <View style={styles.calendarNote}>
            <Text style={styles.calendarNoteText}>
              Calendar permission was denied. Please enable it in your device settings to continue.
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={handleConnectCalendar}
            disabled={syncing}
            style={({ pressed }) => [
              styles.yellowButton,
              pressed && styles.pressedButton,
              syncing && styles.disabledButton,
            ]}
          >
            <Text style={styles.yellowButtonText}>
              {syncing
                ? 'Syncing...'
                : calendarConnected
                  ? 'Re-sync Calendar'
                  : 'Sync Calendar'}
            </Text>
          </Pressable>
        )}

        {calendarConnected && (
          <View style={{ marginTop: 10, paddingHorizontal: 4 }}>
            <Text style={{ fontSize: 13, color: '#16A34A', fontWeight: '600' }}>
              ✓ {syncInfo || 'Phone system calendar connected'}
            </Text>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollView: { flex: 1, paddingHorizontal: 24 },
  scrollContent: { paddingTop: 12, paddingBottom: 24},
  titleSection: { marginBottom: 16 },
  title: { color: COLORS.text, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.7 },
  subtitle: { marginTop: 6, color: COLORS.muted, fontSize: 15, lineHeight: 23 },
  card: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 28, padding: 20, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { flex: 1, color: COLORS.text, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  sparkle: { color: '#B2ABA2', fontSize: 23 },
  badgeRow: { height: 32, position: 'relative', marginBottom: 8 },
  stressBadge: { position: 'absolute', transform: [{ translateX: -50 }], paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18, },
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
  calendarTitle: { color: COLORS.text, fontSize: 17, lineHeight: 22, fontWeight: '700', marginBottom: 4 },
  calendarDescription: { color: '#7D746D', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  calendarNote: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#FEF3C7' },
  calendarNoteText: { color: '#92400E', fontSize: 12, lineHeight: 17, textAlign: 'center' },
  calendarConnected: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 16, backgroundColor: '#EFF6EB', borderWidth: 1, borderColor: '#BBF7D0' },
  connectedInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  connectedIcon: { fontSize: 24, color: '#16A34A', fontWeight: '700' },
  connectedText: { flex: 1 },
  connectedTitle: { color: '#166534', fontSize: 15, fontWeight: '700' },
  connectedDetail: { color: '#15803D', fontSize: 12, marginTop: 2 },
  disconnectButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: '#FEE2E2' },
  disconnectText: { color: '#DC2626', fontSize: 13, fontWeight: '600' },
  connectButton: { width: '100%', height: 52, borderRadius: 16, backgroundColor: COLORS.brown, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  connectButtonIcon: { fontSize: 20 },
  connectButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  bottomContainer: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 50, backgroundColor: COLORS.background },
  setupHint: { color: '#B4892F', fontSize: 12, lineHeight: 17, textAlign: 'center', marginBottom: 10 },
  continueButton: { width: '100%', height: 56, borderRadius: 30, backgroundColor: COLORS.brown, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  continueText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  arrow: { color: '#FFFFFF', fontSize: 22 },
  homeIndicator: { alignSelf: 'center', width: 128, height: 4, borderRadius: 4, backgroundColor: '#C8C1B7', marginTop: 14 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  pressedButton: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  disabledButton: { opacity: 0.6 },
  disabledContinue: { backgroundColor: '#A89F91' },
});
