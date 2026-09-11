import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useFocusEffect, useRouter } from 'expo-router';

import { NavBar, Screen } from '@/components/base';
import { DateChipPicker, TimePicker } from '@/components/taskPickers';
import type { TaskAnalysis } from '@/data/types';
import { ITEMS } from '@/features/calibration/questionnaire';
import { markOnboarded } from '@/lib/bootstrap';
import { toISODate } from '@/services/dateUtils';
import { supabase } from '@/lib/supabaseClient';
import {
  connectCalendar,
  getCalendarConnections,
  getCalendarPermissionStatus,
  updateEventOnDeviceCalendar,
} from '@/services/calendarSync';
import { BASELINE_MIN_SCANS } from '@/services/ppgService';
import {
  analyzeCurrentWeekTasks,
  approveTaskAnalysis,
  getBaseline,
  getTaskAnalyses,
  hasQuestionnaireAnswers,
  latestSelfReport,
  recomputeCurrentWeekDerivedData,
  saveSelfReport,
  syncCalendarToDb,
  updateTaskAnalysis,
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

function getWeekStart(date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return toISODate(d);
}

const CATEGORY_EMOJI: Record<string, string> = {
  academic: '📚',
  work: '💼',
  social: '🌱',
  physical: '🏃',
  mental: '🧘',
  errands: '🛒',
  other: '📌',
};

function getCategoryEmoji(cat: string): string {
  return CATEGORY_EMOJI[cat?.toLowerCase()] || '📌';
}

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

  // Review Modal State for Analysed Tasks
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [tasksToReview, setTasksToReview] = useState<TaskAnalysis[]>([]);
  const [taskIdsToAnalyze, setTaskIdsToAnalyze] = useState<string[]>([]);
  const [editingTask, setEditingTask] = useState<TaskAnalysis | null>(null);
  const [confirming, setConfirming] = useState(false);

  const currentWeekStart = getWeekStart();

  const refresh = React.useCallback(async () => {
    const [baseline, self, questionnaireCompleted, connections, tasks] = await Promise.all([
      getBaseline(),
      latestSelfReport(),
      hasQuestionnaireAnswers(),
      getCalendarConnections(),
      getTaskAnalyses(currentWeekStart),
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

    if (tasks.length > 0) {
      setSyncInfo(`${tasks.length} task(s) synced for this week`);
    }
  }, [currentWeekStart]);

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
      const syncRes = await syncCalendarToDb(currentWeekStart);
      setTaskIdsToAnalyze(syncRes.changedTaskIds);
      await refresh();
      if (syncRes.totalEvents === 0) {
        setSyncInfo('Calendar connected (0 tasks found for this week)');
      } else {
        setSyncInfo(`${syncRes.totalEvents} task(s) synced for this week`);
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
      // Analyze only tasks created or changed by the latest calendar sync.
      const analyzedTasks = await analyzeCurrentWeekTasks(
        currentWeekStart,
        taskIdsToAnalyze.length > 0 ? taskIdsToAnalyze : undefined
      );
      const reviewTasks = taskIdsToAnalyze.length > 0
        ? analyzedTasks.filter((task) => taskIdsToAnalyze.includes(task.id))
        : analyzedTasks.filter((task) => task.status === 'pending');

      if (reviewTasks.length > 0) {
        setTasksToReview(reviewTasks);
        setShowReviewModal(true);
        setSaving(false);
        return;
      }

      // If no tasks, proceed directly
      await saveSelfReport(Math.round(stress), null);
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

  const handleConfirmAndSaveTasks = async () => {
    setConfirming(true);
    try {
      // Approve all reviewed tasks
      for (const t of tasksToReview) {
        await approveTaskAnalysis(t.id, true);
      }
      await recomputeCurrentWeekDerivedData(currentWeekStart);
      await saveSelfReport(Math.round(stress), null);
      await markOnboarded();
      setShowReviewModal(false);
      router.replace('/home');
    } catch (error) {
      console.error('Error confirming baseline tasks:', error);
      Alert.alert('Error', 'Failed to save confirmed tasks. Please try again.');
    } finally {
      setConfirming(false);
    }
  };

  const handleEditField = (field: keyof TaskAnalysis, value: unknown) => {
    setEditingTask((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSaveTaskEdit = async () => {
    if (!editingTask) return;
    try {
      await updateTaskAnalysis(editingTask.id, {
        title: editingTask.title,
        category: editingTask.category,
        priority: editingTask.priority,
        rank: editingTask.rank,
        estimated_duration_hours: editingTask.estimated_duration_hours,
        scheduled_date: editingTask.scheduled_date,
        scheduled_start_time: editingTask.scheduled_start_time,
        scheduled_end_time: editingTask.scheduled_end_time,
      });
      await updateEventOnDeviceCalendar(editingTask.calendar_event_id, editingTask);
      setTasksToReview((prev) =>
        prev.map((t) => (t.id === editingTask.id ? editingTask : t))
      );
      setEditingTask(null);
    } catch (err) {
      console.error('Error saving task edit:', err);
    }
  };

  const handleRejectTask = async (id: string) => {
    try {
      await approveTaskAnalysis(id, false);
      setTasksToReview((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Error rejecting task:', err);
    }
  };

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
      <NavBar title="SET UP" onBack={handleBackToLogin} />
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

      {/* ── AI TASK REVIEW MODAL (Triggered on Continue to Dashboard) ──────── */}
      <Modal visible={showReviewModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {editingTask ? 'Edit Task' : 'AI Workload Review'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {editingTask
                    ? 'Adjust details below and save'
                    : 'Review AI task analysis for this week before entering dashboard'}
                </Text>
              </View>
              {editingTask && (
                <Pressable
                  onPress={() => setEditingTask(null)}
                  hitSlop={8}
                  style={{ padding: 4 }}
                >
                  <Ionicons name="close" size={22} color={colors.inkSoft} />
                </Pressable>
              )}
            </View>

            {editingTask ? (
              /* ── Task Inline Editor ─── */
              <ScrollView
                style={{ maxHeight: 440 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.reviewEditorCard}>
                  {/* Title */}
                  <View style={styles.reviewEditorField}>
                    <Text style={styles.reviewEditorLabel}>Title</Text>
                    <TextInput
                      style={styles.reviewEditorInput}
                      value={editingTask.title}
                      onChangeText={(v) => handleEditField('title', v)}
                      scrollEnabled={false}
                    />
                  </View>

                  {/* Category Pills */}
                  <View style={[styles.reviewEditorField, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                    <Text style={[styles.reviewEditorLabel, { marginBottom: 8 }]}>Category</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {([
                        { key: 'academic', label: '📚 Academic' },
                        { key: 'work', label: '💼 Work' },
                        { key: 'social', label: '🌱 Social' },
                        { key: 'physical', label: '🏃 Physical' },
                        { key: 'mental', label: '🧘 Mental' },
                        { key: 'errands', label: '🛒 Errands' },
                        { key: 'other', label: '📌 Other' },
                      ] as const).map(({ key, label }) => (
                        <Pressable
                          key={key}
                          onPress={() => handleEditField('category', key)}
                          style={[styles.pickerChip, editingTask.category === key && styles.pickerChipActive]}
                        >
                          <Text style={[styles.pickerChipText, editingTask.category === key && styles.pickerChipTextActive]}>
                            {label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  {/* Priority Pills */}
                  <View style={styles.reviewEditorField}>
                    <Text style={styles.reviewEditorLabel}>Priority</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {(['high', 'medium', 'low'] as const).map((p) => (
                        <Pressable
                          key={p}
                          onPress={() => handleEditField('priority', p)}
                          style={[
                            styles.reviewPriorityBtn,
                            editingTask.priority === p && styles.reviewPriorityBtnActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.reviewPriorityBtnText,
                              editingTask.priority === p && { color: colors.cream },
                            ]}
                          >
                            {p.toUpperCase()}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  {/* Hours Stepper */}
                  <View style={styles.reviewEditorField}>
                    <Text style={styles.reviewEditorLabel}>Hours</Text>
                    <View style={styles.stepperRow}>
                      <Pressable
                        onPress={() => handleEditField('estimated_duration_hours', Math.max(0.5, (editingTask.estimated_duration_hours || 1) - 0.5))}
                        style={styles.stepperBtn}
                      >
                        <Text style={styles.stepperBtnText}>−</Text>
                      </Pressable>
                      <Text style={styles.stepperValue}>{editingTask.estimated_duration_hours}h</Text>
                      <Pressable
                        onPress={() => handleEditField('estimated_duration_hours', Math.min(12, (editingTask.estimated_duration_hours || 1) + 0.5))}
                        style={styles.stepperBtn}
                      >
                        <Text style={styles.stepperBtnText}>+</Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* Date Chips — current week Mon-Sun + Other text fallback */}
                  <View style={[styles.reviewEditorField, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                    <Text style={[styles.reviewEditorLabel, { marginBottom: 8 }]}>Date</Text>
                    <DateChipPicker
                      key={`${editingTask.id}-date`}
                      value={editingTask.scheduled_date}
                      onChange={(v) => handleEditField('scheduled_date', v)}
                    />
                  </View>

                  {/* Time Chips — preset slots + Other text fallback */}
                  <View style={[styles.reviewEditorField, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                    <Text style={[styles.reviewEditorLabel, { marginBottom: 8 }]}>Start Time</Text>
                    <TimePicker
                      key={`${editingTask.id}-time`}
                      value={editingTask.scheduled_start_time}
                      onChange={(v) => handleEditField('scheduled_start_time', v)}
                    />
                  </View>

                  {editingTask.ai_reasoning ? (
                    <Text style={styles.reviewEditorReasoning}>
                      AI: {editingTask.ai_reasoning}
                    </Text>
                  ) : null}

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                    <Pressable
                      onPress={() => setEditingTask(null)}
                      style={styles.reviewCancelBtn}
                    >
                      <Text style={styles.reviewCancelBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveTaskEdit}
                      style={styles.reviewSaveBtn}
                    >
                      <Text style={styles.reviewSaveBtnText}>Save Changes</Text>
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            ) : (
              /* ── Task List View ─── */
              <ScrollView
                style={{ maxHeight: 440 }}
                showsVerticalScrollIndicator={false}
              >
                {tasksToReview.map((task) => (
                  <View key={task.id} style={styles.reviewTaskItem}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <View style={styles.reviewRankPill}>
                        <Text style={styles.reviewRankText}>#{task.rank}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View
                          style={[
                            styles.priorityPill,
                            task.priority === 'high'
                              ? styles.pillHigh
                              : task.priority === 'medium'
                                ? styles.pillMed
                                : styles.pillLow,
                          ]}
                        >
                          <Text style={styles.pillText}>{task.priority.toUpperCase()}</Text>
                        </View>
                        <Pressable
                          onPress={() => setEditingTask({ ...task })}
                          style={styles.reviewEditBtn}
                        >
                          <Ionicons name="pencil" size={14} color={colors.brown} />
                          <Text style={styles.reviewEditText}>Edit</Text>
                        </Pressable>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                      <Text style={{ fontSize: 16, marginRight: 6 }}>
                        {getCategoryEmoji(task.category)}
                      </Text>
                      <Text style={styles.reviewTaskTitle}>{task.title}</Text>
                    </View>
                    <Text style={styles.reviewTaskDetails}>
                      {task.category} • {task.estimated_duration_hours}h •{' '}
                      {task.scheduled_date}{' '}
                      {task.scheduled_start_time || 'All Day'}
                    </Text>
                    {task.stress_score != null && (
                      <Text style={styles.reviewTaskStress}>
                        Stress Impact: {task.stress_score}%
                      </Text>
                    )}
                    {task.ai_reasoning ? (
                      <Text style={styles.reviewTaskReasoning}>{task.ai_reasoning}</Text>
                    ) : null}
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'flex-end',
                        marginTop: 6,
                      }}
                    >
                      <Pressable
                        onPress={() => handleRejectTask(task.id)}
                        style={styles.rejectBtn}
                      >
                        <Text style={styles.rejectBtnText}>Skip</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            {!editingTask && (
              <View style={styles.modalActions}>
                <Pressable
                  onPress={handleConfirmAndSaveTasks}
                  disabled={confirming}
                  style={[styles.primaryModalBtn, confirming && { opacity: 0.7 }]}
                >
                  {confirming ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryModalBtnText}>
                      Confirm & Save ({tasksToReview.length} Tasks) →
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>
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
  /* Modal Styles — centered on screen with internal scroll for long content */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, maxHeight: '85%', maxWidth: '92%', width: 420 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  modalSubtitle: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  reviewTaskItem: { backgroundColor: '#FAF8F5', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  reviewRankPill: { backgroundColor: colors.yellowWash, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  reviewRankText: { fontSize: 11, fontWeight: '700', color: colors.brown },
  reviewTaskTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, flex: 1 },
  reviewTaskDetails: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  reviewTaskStress: { fontSize: 12, color: '#B45309', fontWeight: '600', marginTop: 2 },
  reviewTaskReasoning: { fontSize: 11, color: '#4B5563', fontStyle: 'italic', marginTop: 4 },
  reviewEditBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#F8EEDE' },
  reviewEditText: { fontSize: 11, fontWeight: '600', color: colors.brown },
  priorityPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  pillHigh: { backgroundColor: '#FEE2E2', borderColor: '#FECDD3' },
  pillMed: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  pillLow: { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
  pillText: { fontSize: 9, fontWeight: '700', color: colors.inkSoft },
  rejectBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#F3F4F6' },
  rejectBtnText: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  modalActions: { marginTop: 14 },
  primaryModalBtn: { backgroundColor: COLORS.brown, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryModalBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  reviewEditorCard: { backgroundColor: '#FAF8F5', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.line },
  reviewEditorField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  reviewEditorLabel: { fontSize: 13, fontWeight: '600', color: colors.ink, minWidth: 80 },
  reviewEditorInput: { flex: 1, height: 36, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, fontSize: 13, color: colors.ink, textAlign: 'right' },
  reviewEditorHint: { fontSize: 10, color: colors.inkFaint, marginTop: -2, marginBottom: 6, textAlign: 'right' },
  reviewEditorReasoning: { fontSize: 11, color: colors.inkSoft, fontStyle: 'italic', marginTop: 10, lineHeight: 16 },
  reviewPriorityBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFFFF' },
  reviewPriorityBtnActive: { backgroundColor: colors.brown, borderColor: colors.brown },
  reviewPriorityBtnText: { fontSize: 10, fontWeight: '700', color: colors.inkSoft },
  reviewCancelBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  reviewCancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.inkSoft },
  reviewSaveBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.brown, alignItems: 'center' },
  reviewSaveBtnText: { fontSize: 13, fontWeight: '700', color: colors.cream },
  /* Picker chips — category pills, date chips, time chips */
  pickerChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    minWidth: 46,
  },
  pickerChipActive: { backgroundColor: colors.brown, borderColor: colors.brown },
  pickerChipText: { fontSize: 11, fontWeight: '600', color: colors.inkSoft },
  pickerChipTextActive: { color: colors.cream },
  pickerChipSub: { fontSize: 10, color: colors.inkFaint, marginTop: 1 },
  /* Hours stepper */
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.yellowLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  stepperBtnText: { fontSize: 18, fontWeight: '700', color: colors.brown, lineHeight: 22 },
  stepperValue: { fontSize: 15, fontWeight: '700', color: COLORS.text, minWidth: 36, textAlign: 'center' },
});
