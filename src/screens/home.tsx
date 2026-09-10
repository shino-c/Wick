import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import BottomNavigation from '@/components/bottombar';
import TopNavigation from '@/components/topbar';
import type {
  CalendarConnection,
  LoadBalanceSuggestion,
  StressScoreRow,
  TaskAnalysis,
  WeeklyCapacityAnalysis,
} from '@/data/types';
import { analyzeWeeklyCapacity, parseQuickTaskNLP, suggestLoadBalance } from '@/services/aiService';
import { isNewWeek, updateEventOnDeviceCalendar } from '@/services/calendarSync';
import { toISODate } from '@/services/dateUtils';
import {
  approveTaskAnalysis,
  createAndSyncTask,
  deferTaskAnalysis,
  deleteAndSyncTask,
  getCalendarConnections,
  getTaskAnalyses,
  getWeeklyCapacity,
  listStressScores,
  recomputeCurrentWeekDerivedData,
  syncAndAnalyzeCalendar,
  updateTaskAnalysis
} from '@/services/repository';
import { colors } from '@/theme';

const COLORS = {
  background: colors.cream,
  surface: colors.surface,
  text: colors.ink,
  textDark: colors.ink,
  primary: colors.brown,
  primaryContainer: colors.brownSoft,
  border: colors.line,
  outline: colors.inkSoft,
  error: colors.alert,
  warning: colors.warnWash,
  warningBorder: colors.yellowDeep,
  warningText: '#854D0E',
  warningSubtext: '#713F12',
  academic: '#F87171',
  social: '#BAE6FD',
  physical: '#BBF7D0',
  errands: '#FDE2E4',
  mental: '#E9D5FF',
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
  return CATEGORY_EMOJI[cat] || '📌';
}

const PRIORITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  high: { bg: '#FEE2E2', border: '#FECDD3', text: '#E11D48' },
  medium: { bg: '#FEF3C7', border: '#FDE68A', text: '#B45309' },
  low: { bg: '#DCFCE7', border: '#BBF7D0', text: '#16A34A' },
};

export default function Home() {
  const router = useRouter();

  // Core Data State
  const [tasks, setTasks] = useState<TaskAnalysis[]>([]);
  const [capacity, setCapacity] = useState<WeeklyCapacityAnalysis | null>(null);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [loadSuggestions, setLoadSuggestions] = useState<LoadBalanceSuggestion[]>([]);
  const [stressScores, setStressScores] = useState<StressScoreRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Review Modal for Unapproved Tasks (Current Week)
  const [pendingTasks, setPendingTasks] = useState<TaskAnalysis[]>([]);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [approving, setApproving] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskAnalysis | null>(null);

  // Quick Add NLP Chatbot Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [quickInput, setQuickInput] = useState('');
  const [parsingNLP, setParsingNLP] = useState(false);
  const [parsedPreview, setParsedPreview] = useState<Omit<TaskAnalysis, 'id' | 'createdAt'> | null>(null);
  const [editPreview, setEditPreview] = useState<Omit<TaskAnalysis, 'id' | 'createdAt'> | null>(null);
  const [addingTask, setAddingTask] = useState(false);

  // Sync state
  const [resyncing, setResyncing] = useState(false);

  const currentWeekStart = getWeekStart();

  const loadDashboardData = useCallback(async () => {
    try {
      const [allTasks, currentCapacity, allConns, scores] = await Promise.all([
        getTaskAnalyses(currentWeekStart),
        getWeeklyCapacity(currentWeekStart),
        getCalendarConnections(),
        listStressScores(14),
      ]);

      setTasks(allTasks);
      setConnections(allConns);
      setStressScores(scores);

      // Always derive capacity from the real task list for this week so the
      // ring and warning reflect exactly what is scheduled, even if the stored
      // analysis is stale or missing.
      let capacityValue = currentCapacity;
      if (!currentCapacity || currentCapacity.week_start !== currentWeekStart) {
        try {
          capacityValue = await analyzeWeeklyCapacity(allTasks);
          capacityValue.week_start = currentWeekStart;
          capacityValue = await recomputeCurrentWeekDerivedData(currentWeekStart);
        } catch {
          capacityValue = currentCapacity;
        }
      }
      setCapacity(capacityValue);

      // Check for unapproved / newly synced tasks for this week
      const unapproved = allTasks.filter((t) => t.status === 'pending');
      if (unapproved.length > 0) {
        setPendingTasks(unapproved);
        setShowReviewModal(true);
      } else {
        setPendingTasks([]);
      }

      // Generate AI Load Balance Suggestions
      const suggestions = await suggestLoadBalance(allTasks, capacityValue || undefined);
      setLoadSuggestions(suggestions);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [currentWeekStart]);

  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
  );

  // Handle New Week Re-sync
  const deviceConn = connections.find((c) => c.provider === 'device');
  const needsResync = deviceConn ? isNewWeek(deviceConn.lastSyncedAt) : false;

  const handleResyncWeek = async () => {
    setResyncing(true);
    try {
      const res = await syncAndAnalyzeCalendar();
      await loadDashboardData();
      const changed = res.tasksCreated + res.tasksUpdated;
      Alert.alert(
        'Calendar Synced',
        changed > 0
          ? `Analyzed ${changed} new or changed task(s) for this week.`
          : 'No new or changed tasks found for this week.'
      );
    } catch (e: any) {
      Alert.alert('Sync Error', e?.message || 'Could not sync calendar');
    } finally {
      setResyncing(false);
    }
  };

  // Approve all pending tasks from review modal
  const handleApproveAllPending = async () => {
    setApproving(true);
    try {
      for (const t of pendingTasks) {
        await approveTaskAnalysis(t.id, true);
      }
      setShowReviewModal(false);
      await loadDashboardData();
    } catch (err) {
      console.error('Error approving tasks:', err);
    } finally {
      setApproving(false);
    }
  };

  // Reject single pending task
  const handleRejectTask = async (id: string) => {
    try {
      await approveTaskAnalysis(id, false);
      setPendingTasks((prev) => {
        const updated = prev.filter((p) => p.id !== id);
        if (updated.length === 0) setShowReviewModal(false);
        return updated;
      });
      await loadDashboardData();
    } catch (err) {
      console.error('Error rejecting task:', err);
    }
  };

  // Edit a single pending task's field
  const handleEditField = (field: keyof TaskAnalysis, value: unknown) => {
    setEditingTask(prev => prev ? { ...prev, [field]: value } : prev);
  };

  // Save edits to a pending task
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
        status: editingTask.status,
      });
      await updateEventOnDeviceCalendar(editingTask.calendar_event_id, editingTask);
      setPendingTasks(prev => prev.map(t => t.id === editingTask.id ? editingTask : t));
      setEditingTask(null);
      await loadDashboardData();
    } catch (err) {
      console.error('Error saving task edit:', err);
    }
  };
  // Toggle a task between completed and approved (strikethrough + re-rank)
  const handleToggleComplete = async (task: TaskAnalysis) => {
    const completing = task.status !== 'completed';
    try {
      if (completing) {
        // Move completed task to last rank
        const maxRank = Math.max(0, ...tasks.map((t) => t.rank || 0));
        await updateTaskAnalysis(task.id, { status: 'completed', rank: maxRank + 1 }, true);
      } else {
        await updateTaskAnalysis(task.id, { status: 'approved' }, true);
      }
      await recomputeCurrentWeekDerivedData(currentWeekStart);
      await loadDashboardData();
    } catch (err) {
      console.error('Error toggling task completion:', err);
    }
  };

  // Quick Add NLP Parser
  const handleParseNLP = async () => {
    if (!quickInput.trim()) return;
    setParsingNLP(true);
    try {
      const parsed = await parseQuickTaskNLP(quickInput);
      setParsedPreview(parsed);
      setEditPreview(parsed);
    } catch (err) {
      console.error('Error parsing task input:', err);
    } finally {
      setParsingNLP(false);
    }
  };

  // Confirm Add Task (Syncs to Phone Calendar + DB)
  const handleConfirmAddTask = async () => {
    if (!editPreview) return;
    setAddingTask(true);
    try {
      await createAndSyncTask(editPreview);
      setQuickInput('');
      setParsedPreview(null);
      setEditPreview(null);
      setShowAddModal(false);
      await loadDashboardData();
      Alert.alert('Task Created', 'Task has been logged and synced to your phone calendar.');
    } catch (err: any) {
      console.error('Error creating task:', err);
      Alert.alert('Error', err?.message || 'Could not create task');
    } finally {
      setAddingTask(false);
    }
  };

  // Delete Task (Syncs deletion to Phone Calendar + DB)
  const handleDeleteTask = async (task: TaskAnalysis) => {
    Alert.alert('Delete Task', `Delete "${task.title}" and remove it from your device calendar?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAndSyncTask(task.id, task.calendar_event_id);
            await recomputeCurrentWeekDerivedData(currentWeekStart);
            await loadDashboardData();
          } catch (err) {
            console.error('Error deleting task:', err);
          }
        },
      },
    ]);
  };

  // Defer Single Task
  const handleDeferTask = async (suggestion: LoadBalanceSuggestion) => {
    try {
      await deferTaskAnalysis(suggestion.taskId, suggestion.suggestedDate);
      setLoadSuggestions((prev) => prev.filter((s) => s.taskId !== suggestion.taskId));
      await recomputeCurrentWeekDerivedData(currentWeekStart);
      await loadDashboardData();
      Alert.alert('Task Deferred', `"${suggestion.taskTitle}" deferred to next week.`);
    } catch (err) {
      console.error('Error deferring task:', err);
    }
  };

  // Smart Rebalance (Defer all suggestions)
  const handleSmartRebalance = async () => {
    if (loadSuggestions.length === 0) return;
    try {
      for (const s of loadSuggestions) {
        await deferTaskAnalysis(s.taskId, s.suggestedDate);
      }
      setLoadSuggestions([]);
      await recomputeCurrentWeekDerivedData(currentWeekStart);
      await loadDashboardData();
      Alert.alert('Rebalance Applied', 'Low-priority tasks deferred to relieve this week’s workload.');
    } catch (err) {
      console.error('Error applying smart rebalance:', err);
    }
  };

  // Calculate Category Counts for active tasks
  const categoryCounts = {
    academic: tasks.filter((t) => t.category === 'academic' && t.status !== 'deferred').length,
    social: tasks.filter((t) => t.category === 'social' && t.status !== 'deferred').length,
    physical: tasks.filter((t) => t.category === 'physical' && t.status !== 'deferred').length,
    mental: tasks.filter((t) => t.category === 'mental' && t.status !== 'deferred').length,
    errands: tasks.filter((t) => (t.category === 'errands' || t.category === 'work') && t.status !== 'deferred').length,
  };

  // Map real stress scores & daily task workloads to Mon-Sun for the current week
  const weekStartMs = new Date(currentWeekStart + 'T00:00:00').getTime();
  const dayScores: (number | null)[] = [null, null, null, null, null, null, null];

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(weekStartMs + i * 86400000);
    const dayDateStr = dayDate.toISOString().split('T')[0];

    // 1. Check for recorded biometric / fused stress scores on this day
    const scoresOnDay = stressScores.filter((s) => {
      const d = new Date(s.createdAt).toISOString().split('T')[0];
      return d === dayDateStr;
    });

    let dayScore: number | null = null;
    if (scoresOnDay.length > 0) {
      dayScore = Math.round(
        scoresOnDay.reduce((acc, s) => acc + s.fusedScore, 0) / scoresOnDay.length
      );
    }

    // 2. Check for active tasks scheduled on this day
    const dayTasks = tasks.filter(
      (t) =>
        t.scheduled_date === dayDateStr &&
        t.status !== 'deferred' &&
        t.status !== 'rejected'
    );

    if (dayTasks.length > 0) {
      const avgTaskStress =
        dayTasks.reduce((acc, t) => acc + (t.stress_score ?? 50), 0) /
        dayTasks.length;
      const dayHours = dayTasks.reduce(
        (acc, t) => acc + (t.estimated_duration_hours || 1),
        0
      );
      const taskLoadStress = Math.min(
        95,
        Math.round(avgTaskStress * 0.55 + Math.min(45, dayHours * 7))
      );

      if (dayScore !== null) {
        dayScore = Math.round(dayScore * 0.5 + taskLoadStress * 0.5);
      } else {
        dayScore = taskLoadStress;
      }
    }

    dayScores[i] = dayScore;
  }

  // If all days are null (e.g. no measurements and no scheduled tasks), default today
  const todayDayIdx = (new Date().getDay() + 6) % 7;
  const hasAnyDayScore = dayScores.some((s) => s !== null);
  if (!hasAnyDayScore) {
    dayScores[todayDayIdx] = capacity?.stress_score ?? 50;
  }

  // Find the latest day with data for the active-day highlight
  let lastScoredDay = -1;
  for (let i = dayScores.length - 1; i >= 0; i--) {
    if (dayScores[i] !== null) {
      lastScoredDay = i;
      break;
    }
  }

  // Build SVG path from available data points
  // Chart area: x 20..365, y 100 (score=0) to 20 (score=100)
  const chartLeft = 20;
  const chartRight = 365;
  const chartTop = 20;
  const chartBottom = 100;
  const xStep = (chartRight - chartLeft) / 6;

  const points: { x: number; y: number; score: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const score = dayScores[i];
    const x = chartLeft + i * xStep;
    if (score !== null) {
      const clampedScore = Math.max(0, Math.min(100, score));
      const y = chartBottom - (clampedScore / 100) * (chartBottom - chartTop);
      points.push({ x, y, score: clampedScore });
    }
  }

  // Generate smooth path through the points
  let stressPath = '';
  let stressGradientPath = '';
  if (points.length >= 2) {
    const lineParts = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`);
    stressPath = lineParts.join(' ');
    stressGradientPath =
      stressPath +
      ` L ${points[points.length - 1].x} ${chartBottom} L ${points[0].x} ${chartBottom} Z`;
  } else if (points.length === 1) {
    stressPath = `M ${Math.max(chartLeft, points[0].x - 16)} ${points[0].y} L ${Math.min(chartRight, points[0].x + 16)} ${points[0].y}`;
    stressGradientPath = `M ${Math.max(chartLeft, points[0].x - 16)} ${points[0].y} L ${Math.min(chartRight, points[0].x + 16)} ${points[0].y} L ${Math.min(chartRight, points[0].x + 16)} ${chartBottom} L ${Math.max(chartLeft, points[0].x - 16)} ${chartBottom} Z`;
  }

  const usedHours = capacity?.used_capacity_hours ?? 0;
  const totalHours = capacity?.total_capacity_hours ?? 40;
  const capacityPct = Math.min(100, Math.round((usedHours / totalHours) * 100));
  const isOverloaded = capacity?.overload_warning || capacityPct >= 85;

  // Real Category Percentages from capacity breakdown
  const academicPct = capacity?.category_breakdown?.academic ?? 0;
  const workPct = capacity?.category_breakdown?.work ?? 0;
  const socialPct = capacity?.category_breakdown?.social ?? 0;
  const physicalPct = capacity?.category_breakdown?.physical ?? 0;
  const mentalPct = capacity?.category_breakdown?.mental ?? 0;
  const errandsPct = capacity?.category_breakdown?.errands ?? 0;

  /** Real cue for the recovery reminder — today's own data */
  const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0 .. Sun=6
  const todayStress = dayScores[todayIdx];
  const recoveryReminderVisible =
    isOverloaded || (todayStress !== null && todayStress >= 60);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={styles.container}>
        <TopNavigation onNotificationPress={() => {}} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* New Week Re-sync Reminder Banner */}
          {needsResync && (
            <View style={styles.resyncBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <MaterialIcons name="event" size={22} color="#854D0E" style={{ marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.resyncTitle}>New Week Detected</Text>
                  <Text style={styles.resyncSubtext}>Re-sync calendar to analyze this week's events.</Text>
                </View>
              </View>
              <Pressable
                onPress={handleResyncWeek}
                disabled={resyncing}
                style={[styles.resyncButton, resyncing && { opacity: 0.7 }]}
              >
                {resyncing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.resyncButtonText}>Sync Week</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* 1. Your Stress This Week */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Your Stress This Week</Text>
              <View style={styles.adaptiveBadge}>
                <Text style={styles.adaptiveText}>Adaptive</Text>
              </View>
            </View>

            {/* Stress Line Chart */}
            <View style={styles.chartContainer}>
              <Svg height="120" width="100%" viewBox="0 0 380 120">
                <Defs>
                  <LinearGradient id="stressGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <Stop offset="0%" stopColor="#ba1a1a" stopOpacity="0.22" />
                    <Stop offset="60%" stopColor="#fdcb9b" stopOpacity="0.1" />
                    <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                  </LinearGradient>
                </Defs>

                {/* Grid lines */}
                <Line x1="10" y1="20" x2="370" y2="20" stroke="#f2eede" strokeWidth="1" strokeDasharray="4 4" />
                <Line x1="10" y1="60" x2="370" y2="60" stroke="#f2eede" strokeWidth="1" strokeDasharray="4 4" />
                <Line x1="10" y1="100" x2="370" y2="100" stroke="#f2eede" strokeWidth="1" />

                {/* Gradient fill */}
                {stressGradientPath ? (
                  <Path d={stressGradientPath} fill="url(#stressGradient)" />
                ) : null}

                {/* Line */}
                {stressPath ? (
                  <Path
                    d={stressPath}
                    stroke="#7c5730"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                ) : null}

                {/* Data points */}
                {points.map((p, i) => (
                  <Circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={p.x === chartLeft + lastScoredDay * xStep ? 6 : 3.5}
                    fill={p.x === chartLeft + lastScoredDay * xStep ? '#ba1a1a' : '#81756c'}
                    stroke={p.x === chartLeft + lastScoredDay * xStep ? '#ffffff' : 'none'}
                    strokeWidth={p.x === chartLeft + lastScoredDay * xStep ? 2.5 : 0}
                  />
                ))}

                {/* Empty state: flat line at 50% */}
                {points.length === 0 && (
                  <Line x1="20" y1="60" x2="365" y2="60" stroke="#ddd" strokeWidth="1.5" strokeDasharray="6 4" />
                )}
              </Svg>

              <View style={styles.daysRow}>
                <Text style={styles.dayText}>M</Text>
                <Text style={styles.dayText}>T</Text>
                <Text style={styles.dayText}>W</Text>
                <Text style={styles.dayText}>T</Text>
                <Text style={styles.dayText}>F</Text>
                <Text style={styles.dayText}>S</Text>
                <Text style={styles.dayText}>S</Text>
              </View>
            </View>

            {/* Early Warning Banner */}
            <View style={styles.insightBanner}>
              <View style={styles.insightIconContainer}>
                <MaterialIcons
                  name={isOverloaded ? 'warning' : 'notifications-active'}
                  size={18}
                  color={isOverloaded ? '#DC2626' : '#E07A5F'}
                />
              </View>
              <View style={styles.insightContent}>
                <Text style={styles.insightTitle}>
                  {isOverloaded ? 'Cognitive Load Warning' : 'Workload Insight'}
                </Text>
                <Text style={styles.insightText}>
                  {capacity?.ai_reasoning ||
                    'Your weekly cognitive load is being tracked from active calendar events and baseline metrics.'}
                </Text>
              </View>
            </View>
          </View>

          {/* Gentle recovery reminder */}
          {recoveryReminderVisible && (
            <Pressable
              onPress={() => router.push('/recovery')}
              style={({ pressed }) => [styles.recoveryReminder, pressed && styles.pressed]}
            >
              <View style={styles.recoveryReminderIcon}>
                <Text style={{ fontSize: 20 }}>🌱</Text>
              </View>
              <View style={styles.recoveryReminderBody}>
                <Text style={styles.recoveryReminderTitle}>A softer moment, if you want one</Text>
                <Text style={styles.recoveryReminderText}>
                  {isOverloaded
                    ? 'This week is carrying a lot. Your garden has a few gentle, optional ideas — no pressure.'
                    : 'Today is measuring a bit heavier than usual. A small pause in your garden might feel nice.'}
                </Text>
              </View>
              <Text style={styles.recoveryReminderArrow}>›</Text>
            </Pressable>
          )}

          {/* 2. Weekly Capacity */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.sectionLabel}>WEEKLY CAPACITY</Text>
              <View style={[styles.nearLimitBadge, isOverloaded && { backgroundColor: '#FEE2E2' }]}>
                <Text style={[styles.nearLimitText, isOverloaded && { color: '#DC2626' }]}>
                  {capacityPct >= 100 ? 'Overloaded' : capacityPct >= 85 ? 'Near Limit' : 'Balanced'}
                </Text>
              </View>
            </View>

            <View style={styles.capacityContainer}>
              <View style={styles.capacityCircleWrapper}>
                <Svg height="144" width="144" viewBox="0 0 120 120" style={{ transform: [{ rotate: '-90deg' }] }}>
                  <Circle cx="60" cy="60" r="48" fill="none" stroke="#F3F4F6" strokeWidth="12" />
                  <Circle
                    cx="60"
                    cy="60"
                    r="48"
                    fill="none"
                    stroke={isOverloaded ? '#EF4444' : '#E07A5F'}
                    strokeWidth="12"
                    strokeDasharray={`${(capacityPct / 100) * 301.59} 301.59`}
                    strokeDashoffset="0"
                  />
                </Svg>
                <View style={styles.capacityOverlay}>
                  <View style={styles.capacityNumberRow}>
                    <Text style={styles.capacityNumber}>{capacityPct}</Text>
                    <Text style={styles.capacityPercent}>%</Text>
                  </View>
                  <Text style={styles.capacityLabel}>Capacity</Text>
                </View>
              </View>
            </View>

            {/* Overload Warning Box */}
            {isOverloaded && (
              <View style={styles.capacityWarning}>
                <MaterialIcons name="warning" size={20} color="#CA8A04" style={{ marginRight: 10, marginTop: 2 }} />
                <View style={styles.warningContent}>
                  <Text style={styles.warningTitle}>Overload Warning ({capacityPct}% capacity)</Text>
                  <Text style={styles.warningText}>
                    You have {usedHours}h of scheduled load against a {totalHours}h threshold. Consider deferring
                    lower-priority tasks below.
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.capacitySection}>
              {/* Dynamic Category Breakdown Bar */}
              <View style={styles.capacityBar}>
                {academicPct > 0 && (
                  <View style={[styles.capacitySegment, { width: `${academicPct}%`, backgroundColor: COLORS.academic }]} />
                )}
                {workPct > 0 && (
                  <View style={[styles.capacitySegment, { width: `${workPct}%`, backgroundColor: '#FCD34D' }]} />
                )}
                {socialPct > 0 && (
                  <View style={[styles.capacitySegment, { width: `${socialPct}%`, backgroundColor: COLORS.social }]} />
                )}
                {physicalPct > 0 && (
                  <View style={[styles.capacitySegment, { width: `${physicalPct}%`, backgroundColor: COLORS.physical }]} />
                )}
                {errandsPct > 0 && (
                  <View style={[styles.capacitySegment, { width: `${errandsPct}%`, backgroundColor: COLORS.errands }]} />
                )}
                {mentalPct > 0 && (
                  <View style={[styles.capacitySegment, { width: `${mentalPct}%`, backgroundColor: COLORS.mental }]} />
                )}
                {usedHours === 0 && (
                  <View style={[styles.capacitySegment, { width: '100%', backgroundColor: '#E5E7EB' }]} />
                )}
              </View>

              {/* Legend with Real Category Percentages */}
              <View style={styles.legendContainer}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.academic }]} />
                  <Text style={styles.legendText}>Academic ({academicPct}%)</Text>
                </View>
                {workPct > 0 && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#FCD34D' }]} />
                    <Text style={styles.legendText}>Work ({workPct}%)</Text>
                  </View>
                )}
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.social }]} />
                  <Text style={styles.legendText}>Social ({socialPct}%)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.physical }]} />
                  <Text style={styles.legendText}>Physical ({physicalPct}%)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.errands }]} />
                  <Text style={styles.legendText}>Errands ({errandsPct}%)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.mental }]} />
                  <Text style={styles.legendText}>Mental ({mentalPct}%)</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 3. Categorized Load Map */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Categorized Load Map</Text>
              <Pressable onPress={() => setShowAddModal(true)} style={styles.addInlineButton}>
                <MaterialIcons name="add" size={16} color={COLORS.primary} />
                <Text style={styles.addInlineText}>Quick Add</Text>
              </Pressable>
            </View>

            <View style={styles.categoryGrid}>
              <CategoryCard
                emoji="📚"
                title="Academic"
                description="Thesis, Exams & Study"
                badge={`${categoryCounts.academic} Tasks`}
                background="#FFEAEA"
                border="#FECDD3"
                badgeBackground="#FFE4E6"
                badgeColor="#E11D48"
              />
              <CategoryCard
                emoji="🌱"
                title="Social & Community"
                description="Meetups & calls"
                badge={`${categoryCounts.social} Events`}
                background="#E0F2FE"
                border="#BAE6FD"
                badgeBackground="#BAE6FD"
                badgeColor="#0284C7"
              />
              <CategoryCard
                emoji="🏃"
                title="Physical Health"
                description="Workout, Gym & Run"
                badge={`${categoryCounts.physical} Sessions`}
                background="#DCFCE7"
                border="#BBF7D0"
                badgeBackground="#BBF7D0"
                badgeColor="#16A34A"
              />
              <CategoryCard
                emoji="🧘"
                title="Mental/Downtime"
                description="Breathing, reading"
                badge={`${categoryCounts.mental} Sessions`}
                background="#F3E8FF"
                border="#E9D5FF"
                badgeBackground="#E9D5FF"
                badgeColor="#9333EA"
              />
              <View style={[styles.categoryFull, { backgroundColor: '#FDF2F4', borderColor: '#FBCFE8' }]}>
                <View style={styles.otherLeft}>
                  <Text style={styles.categoryEmoji}>🛒</Text>
                  <View style={{ marginLeft: 10 }}>
                    <Text style={styles.categoryTitle}>Others & Errands</Text>
                    <Text style={styles.categoryDescription}>Chores, Meetings & Misc</Text>
                  </View>
                </View>
                <View style={styles.otherBadge}>
                  <Text style={styles.otherBadgeText}>{categoryCounts.errands} Items</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 4. AI Ranked Tasks for This Week (Tap card to toggle done/strikethrough) */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Tasks This Week</Text>
              <Pressable onPress={() => setShowAddModal(true)} style={styles.iconButton}>
                <MaterialIcons name="add-circle" size={24} color={COLORS.primary} />
              </Pressable>
            </View>

            {tasks.length === 0 ? (
              <View style={styles.emptyTasks}>
                <Text style={styles.emptyTasksText}>No tasks logged for this week.</Text>
                <Pressable onPress={() => setShowAddModal(true)} style={styles.addFirstTaskBtn}>
                  <Text style={styles.addFirstTaskText}>+ Quick Add</Text>
                </Pressable>
              </View>
            ) : (
              tasks.map((task) => {
                const done = task.status === 'completed';
                const catEmoji = getCategoryEmoji(task.category);
                const priorityStyle = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;
                return (
                  <Pressable
                    key={task.id}
                    onPress={() => handleToggleComplete(task)}
                    style={({ pressed }) => [
                      styles.taskCard,
                      done && styles.taskCardDone,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.taskLeftBorder, done && { backgroundColor: colors.inkFaint }]} />
                    <View
                      style={[styles.taskRankBadge, done && styles.taskRankBadgeDone]}
                    >
                      <Text style={[styles.taskRankText, done && styles.taskRankTextDone]}>
                        {done ? '✓' : `#${task.rank}`}
                      </Text>
                    </View>
                    <View style={styles.taskBody}>
                      <View style={styles.taskTitleRow}>
                        <Text style={styles.taskCatEmoji}>{catEmoji}</Text>
                        <Text
                          style={[styles.taskTitleText, done && styles.taskTitleDone]}
                          numberOfLines={1}
                        >
                          {task.title}
                        </Text>
                      </View>
                      <View style={styles.taskTagsRow}>
                        <View style={[styles.priorityPill, { backgroundColor: priorityStyle.bg, borderColor: priorityStyle.border }]}>
                          <Text style={[styles.pillText, { color: priorityStyle.text }]}>{task.priority.toUpperCase()}</Text>
                        </View>
                        <Text style={[styles.taskSubDetail, done && styles.taskSubDone]}>
                          {task.category} • {task.estimated_duration_hours}h
                          {task.scheduled_start_time ? ` • ${task.scheduled_start_time}` : ''}
                          {task.scheduled_date ? ` • ${task.scheduled_date}` : ''}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setEditingTask({ ...task });
                        setShowReviewModal(true);
                      }}
                      style={styles.editButton}
                      hitSlop={8}
                    >
                      <MaterialIcons name="edit" size={17} color={colors.inkSoft} />
                    </Pressable>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        handleDeleteTask(task);
                      }}
                      style={styles.deleteButton}
                      hitSlop={8}
                    >
                      <MaterialIcons name="delete-outline" size={18} color={colors.inkFaint} />
                    </Pressable>
                  </Pressable>
                );
              })
            )}
          </View>

          {/* 5. Load Balancer */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Smart Load Balancer</Text>
              {isOverloaded && (
                <View style={styles.spikeBadge}>
                  <Text style={styles.spikeText}>SPIKE DETECTED</Text>
                </View>
              )}
            </View>

            <Text style={styles.loadDescription}>
              {loadSuggestions.length > 0
                ? 'Consider deferring these lower-priority tasks to relieve cognitive pressure this week:'
                : 'Your schedule is currently balanced. No deferrals required right now.'}
            </Text>

            {loadSuggestions.map((suggestion) => (
              <TaskRow
                key={suggestion.taskId}
                emoji="🗂️"
                title={suggestion.taskTitle}
                subtitle={suggestion.reason}
                onDefer={() => handleDeferTask(suggestion)}
              />
            ))}

            {loadSuggestions.length > 0 && (
              <Pressable onPress={handleSmartRebalance} style={styles.rebalanceButton}>
                <MaterialIcons name="settings" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.rebalanceText}>Apply Smart Rebalance</Text>
              </Pressable>
            )}
          </View>

          <View style={{ height: 60 }} />
        </ScrollView>

        {/* Bottom Navigation */}
        <BottomNavigation activeTab="Home" router={router} />
      </View>

      {/* ── AI REVIEW MODAL (Triggered for newly synced weekly tasks) ─────── */}
      <Modal visible={showReviewModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {editingTask ? 'Edit Task' : 'Workload Review'}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {editingTask ? 'Change details below, then save' : 'Tap Edit to change any detail, then Approve'}
                </Text>
              </View>
              {editingTask && (
                <Pressable onPress={() => setEditingTask(null)} hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="close" size={22} color={colors.inkSoft} />
                </Pressable>
              )}
            </View>

            {editingTask ? (
              /* ── Inline Task Editor ─── */
              <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={styles.reviewEditorCard}>
                  <View style={styles.reviewEditorField}>
                    <Text style={styles.reviewEditorLabel}>Rank</Text>
                    <TextInput
                      style={[styles.reviewEditorInput, { width: 70 }]}
                      value={String(editingTask.rank)}
                      onChangeText={(v) => handleEditField('rank', parseInt(v) || 1)}
                      keyboardType="number-pad"
                    />
                  </View>

                  <View style={styles.reviewEditorField}>
                    <Text style={styles.reviewEditorLabel}>Title</Text>
                    <TextInput
                      style={styles.reviewEditorInput}
                      value={editingTask.title}
                      onChangeText={(v) => handleEditField('title', v)}
                    />
                  </View>

                  <View style={styles.reviewEditorField}>
                    <Text style={styles.reviewEditorLabel}>Category</Text>
                    <TextInput
                      style={styles.reviewEditorInput}
                      value={editingTask.category}
                      onChangeText={(v) => handleEditField('category', v)}
                    />
                  </View>
                  <Text style={styles.reviewEditorHint}>academic, work, social, physical, mental, errands</Text>

                  <View style={styles.reviewEditorField}>
                    <Text style={styles.reviewEditorLabel}>Priority</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {(['high', 'medium', 'low'] as const).map(p => (
                        <Pressable
                          key={p}
                          onPress={() => handleEditField('priority', p)}
                          style={[styles.reviewPriorityBtn, editingTask.priority === p && styles.reviewPriorityBtnActive]}
                        >
                          <Text style={[styles.reviewPriorityBtnText, editingTask.priority === p && { color: colors.cream }]}>
                            {p.toUpperCase()}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={styles.reviewEditorField}>
                    <Text style={styles.reviewEditorLabel}>Hours</Text>
                    <TextInput
                      style={[styles.reviewEditorInput, { width: 70 }]}
                      value={String(editingTask.estimated_duration_hours)}
                      onChangeText={(v) => handleEditField('estimated_duration_hours', parseFloat(v) || 1)}
                      keyboardType="decimal-pad"
                    />
                  </View>

                  <View style={styles.reviewEditorField}>
                    <Text style={styles.reviewEditorLabel}>Date</Text>
                    <TextInput
                      style={styles.reviewEditorInput}
                      value={editingTask.scheduled_date}
                      onChangeText={(v) => handleEditField('scheduled_date', v)}
                      placeholder="YYYY-MM-DD"
                    />
                  </View>

                  <View style={styles.reviewEditorField}>
                    <Text style={styles.reviewEditorLabel}>Start Time</Text>
                    <TextInput
                      style={[styles.reviewEditorInput, { width: 90 }]}
                      value={editingTask.scheduled_start_time || ''}
                      onChangeText={(v) => handleEditField('scheduled_start_time', v)}
                      placeholder="HH:MM"
                    />
                  </View>

                  {editingTask.ai_reasoning ? (
                    <Text style={styles.reviewEditorReasoning}>{editingTask.ai_reasoning}</Text>
                  ) : null}

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                    <Pressable onPress={() => setEditingTask(null)} style={styles.reviewCancelBtn}>
                      <Text style={styles.reviewCancelBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable onPress={handleSaveTaskEdit} style={styles.reviewSaveBtn}>
                      <Text style={styles.reviewSaveBtnText}>Save Changes</Text>
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            ) : (
              /* ── Task List View ─── */
              <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
                {pendingTasks.map((task) => (
                  <View key={task.id} style={styles.reviewTaskItem}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={styles.reviewRankPill}>
                        <Text style={styles.reviewRankText}>#{task.rank}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[styles.priorityPill, task.priority === 'high' ? styles.pillHigh : task.priority === 'medium' ? styles.pillMed : styles.pillLow]}>
                          <Text style={styles.pillText}>{task.priority.toUpperCase()}</Text>
                        </View>
                        <Pressable onPress={() => setEditingTask({ ...task })} style={styles.reviewEditBtn}>
                          <Ionicons name="pencil" size={14} color={colors.brown} />
                          <Text style={styles.reviewEditText}>Edit</Text>
                        </Pressable>
                      </View>
                    </View>
                    <Text style={styles.reviewTaskTitle}>{task.title}</Text>
                    <Text style={styles.reviewTaskDetails}>
                      {task.category} • {task.estimated_duration_hours}h • {task.scheduled_date} {task.scheduled_start_time || 'All Day'}
                    </Text>
                    {task.stress_score != null && (
                      <Text style={styles.reviewTaskStress}>Stress Impact: {task.stress_score}%</Text>
                    )}
                    {task.ai_reasoning ? (
                      <Text style={styles.reviewTaskReasoning}>{task.ai_reasoning}</Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 }}>
                      <Pressable onPress={() => handleRejectTask(task.id)} style={styles.rejectBtn}>
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
                  onPress={handleApproveAllPending}
                  disabled={approving || pendingTasks.length === 0}
                  style={[styles.primaryModalBtn, (approving || pendingTasks.length === 0) && { opacity: 0.7 }]}
                >
                  {approving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryModalBtnText}>
                      {pendingTasks.length > 0 ? `Approve & Save (${pendingTasks.length})` : 'All Tasks Reviewed'}
                    </Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── QUICK ADD NLP CHATBOT MODAL (2-Way Calendar Sync) ─────────────── */}
      <Modal visible={showAddModal} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '92%' }]}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Quick Task Logger</Text>
                  <Text style={styles.modalSubtitle}>
                    Type naturally (e.g. "2 assignment due Fri", "Exam Thu 2pm")
                  </Text>
                </View>
                <Pressable onPress={() => { setShowAddModal(false); setParsedPreview(null); setEditPreview(null); setQuickInput(''); }} hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="close" size={22} color={colors.inkSoft} />
                </Pressable>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 16 }}
              >
                <TextInput
                  style={styles.chatInput}
                  placeholder="e.g. 2 assignment due Fri, Gym tomorrow 6pm..."
                  placeholderTextColor={colors.inkFaint}
                  value={quickInput}
                  onChangeText={setQuickInput}
                  multiline
                />

                <Pressable
                  onPress={handleParseNLP}
                  disabled={parsingNLP || !quickInput.trim()}
                  style={[styles.nlpParseButton, (!quickInput.trim() || parsingNLP) && { opacity: 0.6 }]}
                >
                  {parsingNLP ? (
                    <ActivityIndicator size="small" color={colors.cream} />
                  ) : (
                    <Text style={styles.nlpParseButtonText}>Analyze</Text>
                  )}
                </Pressable>

                {/* Editable Details Preview */}
                {editPreview && (
                  <View style={styles.previewBox}>
                    <Text style={styles.previewHeader}>DETAILS DETECTED</Text>

                    <View style={styles.previewFieldRow}>
                      <Text style={styles.previewFieldLabel}>Title</Text>
                      <TextInput
                        style={styles.previewInput}
                        value={editPreview.title}
                        onChangeText={(v) => setEditPreview(p => p ? { ...p, title: v } : p)}
                      />
                    </View>

                    <View style={styles.previewFieldRow}>
                      <Text style={styles.previewFieldLabel}>Category</Text>
                      <TextInput
                        style={styles.previewInput}
                        value={editPreview.category}
                        onChangeText={(v) => setEditPreview(p => p ? { ...p, category: v } : p)}
                      />
                    </View>
                    <Text style={styles.previewFieldHint}>academic, work, social, physical, mental, errands</Text>

                    <View style={styles.previewFieldRow}>
                      <Text style={styles.previewFieldLabel}>Priority</Text>
                      <View style={styles.previewPriorityRow}>
                        {(['high', 'medium', 'low'] as const).map(p => (
                          <Pressable
                            key={p}
                            onPress={() => setEditPreview(prev => prev ? { ...prev, priority: p } : prev)}
                            style={[styles.previewPriorityBtn, editPreview.priority === p && styles.previewPriorityBtnActive]}
                          >
                            <Text style={[styles.previewPriorityBtnText, editPreview.priority === p && styles.previewPriorityBtnTextActive]}>
                              {p.toUpperCase()}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>

                    <View style={styles.previewFieldRow}>
                      <Text style={styles.previewFieldLabel}>Hours</Text>
                      <TextInput
                        style={[styles.previewInput, { width: 60 }]}
                        value={String(editPreview.estimated_duration_hours)}
                        onChangeText={(v) => setEditPreview(p => p ? { ...p, estimated_duration_hours: parseFloat(v) || 1 } : p)}
                        keyboardType="decimal-pad"
                      />
                    </View>

                    <View style={styles.previewFieldRow}>
                      <Text style={styles.previewFieldLabel}>Date</Text>
                      <TextInput
                        style={styles.previewInput}
                        value={editPreview.scheduled_date}
                        onChangeText={(v) => setEditPreview(p => p ? { ...p, scheduled_date: v } : p)}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={colors.inkFaint}
                      />
                    </View>

                    <View style={styles.previewFieldRow}>
                      <Text style={styles.previewFieldLabel}>Time</Text>
                      <TextInput
                        style={[styles.previewInput, { width: 80 }]}
                        value={editPreview.scheduled_start_time || ''}
                        onChangeText={(v) => setEditPreview(p => p ? { ...p, scheduled_start_time: v } : p)}
                        placeholder="HH:MM"
                        placeholderTextColor={colors.inkFaint}
                      />
                    </View>

                    <View style={styles.previewFieldRow}>
                      <Text style={styles.previewFieldLabel}>Stress</Text>
                      <Text style={styles.previewStressValue}>{editPreview.stress_score}%</Text>
                    </View>

                    <Pressable
                      onPress={handleConfirmAddTask}
                      disabled={addingTask}
                      style={[styles.primaryModalBtn, { marginTop: 12 }, addingTask && { opacity: 0.7 }]}
                    >
                      {addingTask ? (
                        <ActivityIndicator size="small" color={colors.cream} />
                      ) : (
                        <Text style={styles.primaryModalBtnText}>Approve & Sync to Calendar</Text>
                      )}
                    </Pressable>
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function CategoryCard({
  emoji,
  title,
  description,
  badge,
  background,
  border,
  badgeBackground,
  badgeColor,
}: {
  emoji: string;
  title: string;
  description: string;
  badge: string;
  background: string;
  border: string;
  badgeBackground: string;
  badgeColor: string;
}) {
  return (
    <View style={[styles.categoryCard, { backgroundColor: background, borderColor: border }]}>
      <View style={styles.categoryTop}>
        <Text style={styles.categoryEmoji}>{emoji}</Text>
        <View style={[styles.categoryBadge, { backgroundColor: badgeBackground }]}>
          <Text style={[styles.categoryBadgeText, { color: badgeColor }]}>{badge}</Text>
        </View>
      </View>
      <View style={styles.categoryBottom}>
        <Text style={styles.categoryTitle}>{title}</Text>
        <Text style={styles.categoryDescription}>{description}</Text>
      </View>
    </View>
  );
}

function TaskRow({
  emoji,
  title,
  subtitle,
  onDefer,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  onDefer: () => void;
}) {
  return (
    <View style={styles.taskRow}>
      <View style={styles.taskLeft}>
        <Text style={styles.taskEmoji}>{emoji}</Text>
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={styles.taskTitle}>{title}</Text>
          <Text style={styles.taskSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <Pressable onPress={onDefer} style={({ pressed }) => [styles.deferButton, pressed && styles.pressed]}>
        <Text style={styles.deferText}>Defer</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  adaptiveBadge: { backgroundColor: '#F3E8FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  adaptiveText: { fontSize: 12, fontWeight: '600', color: '#7E22CE' },
  chartContainer: { alignItems: 'center', marginBottom: 12 },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 8, paddingHorizontal: 10 },
  dayText: { fontSize: 13, color: '#81756C', fontWeight: '500' },
  insightBanner: { flexDirection: 'row', backgroundColor: '#FFF5F0', borderRadius: 12, padding: 12, marginTop: 4 },
  insightIconContainer: { marginRight: 8, marginTop: 2 },
  insightContent: { flex: 1 },
  insightTitle: { fontSize: 14, fontWeight: '700', color: '#E07A5F', marginBottom: 2 },
  insightText: { fontSize: 12, color: '#6B7280', lineHeight: 18 },
  recoveryReminder: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF4E6',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#D9E5C8',
  },
  recoveryReminderIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  recoveryReminderBody: { flex: 1 },
  recoveryReminderTitle: { fontSize: 14, fontWeight: '700', color: '#3F5A2A', marginBottom: 2 },
  recoveryReminderText: { fontSize: 12, color: '#5C6F44', lineHeight: 18 },
  recoveryReminderArrow: { fontSize: 22, color: '#7C9460', marginLeft: 8, marginTop: -2 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5 },
  nearLimitBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  nearLimitText: { fontSize: 12, fontWeight: '700', color: '#D97706' },
  capacityContainer: { alignItems: 'center', marginVertical: 8 },
  capacityCircleWrapper: { position: 'relative', width: 144, height: 144, alignItems: 'center', justifyContent: 'center' },
  capacityOverlay: { position: 'absolute', alignItems: 'center' },
  capacityNumberRow: { flexDirection: 'row', alignItems: 'baseline' },
  capacityNumber: { fontSize: 32, fontWeight: '800', color: COLORS.text },
  capacityPercent: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginLeft: 2 },
  capacityLabel: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  capacityWarning: { flexDirection: 'row', backgroundColor: '#FEF9C3', borderRadius: 12, padding: 12, marginVertical: 8 },
  warningContent: { flex: 1 },
  warningTitle: { fontSize: 13, fontWeight: '700', color: '#854D0E', marginBottom: 2 },
  warningText: { fontSize: 12, color: '#713F12', lineHeight: 16 },
  capacitySection: { marginTop: 8 },
  capacityBar: { height: 10, borderRadius: 5, flexDirection: 'row', overflow: 'hidden', backgroundColor: '#E5E7EB', marginBottom: 10 },
  capacitySegment: { height: '100%' },
  legendContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  legendText: { fontSize: 11, color: '#6B7280' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  categoryCard: { width: '48%', borderRadius: 14, padding: 12, marginBottom: 12, borderWidth: 1 },
  categoryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  categoryEmoji: { fontSize: 20 },
  categoryBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  categoryBadgeText: { fontSize: 10, fontWeight: '700' },
  categoryBottom: {},
  categoryTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  categoryDescription: { fontSize: 11, color: '#6B7280' },
  categoryFull: { width: '100%', borderRadius: 14, padding: 12, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  otherLeft: { flexDirection: 'row', alignItems: 'center' },
  otherBadge: { backgroundColor: '#FCE7F3', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  otherBadgeText: { fontSize: 11, fontWeight: '700', color: '#DB2777' },
  addInlineButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#F8EEDE' },
  addInlineText: { fontSize: 12, fontWeight: '600', color: COLORS.primary, marginLeft: 2 },
  iconButton: { padding: 4 },
  emptyTasks: { padding: 20, alignItems: 'center' },
  emptyTasksText: { fontSize: 13, color: '#9CA3AF', marginBottom: 10 },
  addFirstTaskBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addFirstTaskText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  /* Task Card */
  taskCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 14, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  taskCardDone: { opacity: 0.55, backgroundColor: '#FAFAF8' },
  taskLeftBorder: { width: 4, alignSelf: 'stretch', backgroundColor: colors.brown, borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  taskRankBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.yellowWash, alignItems: 'center', justifyContent: 'center', marginHorizontal: 10 },
  taskRankText: { fontSize: 12, fontWeight: '800', color: colors.brown },
  taskRankBadgeDone: { backgroundColor: colors.calmWash },
  taskRankTextDone: { fontSize: 14, fontWeight: '800', color: colors.calm },
  taskBody: { flex: 1, paddingVertical: 10, paddingRight: 4 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  taskCatEmoji: { fontSize: 14, marginRight: 6 },
  taskTitleText: { fontSize: 14, fontWeight: '700', color: COLORS.text, flex: 1 },
  taskTitleDone: { textDecorationLine: 'line-through', color: colors.inkFaint },
  taskTagsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priorityPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  pillHigh: { backgroundColor: '#FEE2E2', borderColor: '#FECDD3' },
  pillMed: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  pillLow: { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
  pillText: { fontSize: 9, fontWeight: '700', color: colors.inkSoft },
  taskSubDetail: { fontSize: 11, color: colors.inkSoft, flexShrink: 1 },
  taskSubDone: { color: colors.inkFaint },
  editButton: { padding: 8 },
  deleteButton: { padding: 8 },
  spikeBadge: { backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  spikeText: { fontSize: 10, fontWeight: '800', color: '#DC2626' },
  loadDescription: { fontSize: 13, color: '#6B7280', marginBottom: 12, lineHeight: 18 },
  taskRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  taskLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  taskEmoji: { fontSize: 20 },
  taskTitle: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  taskSubtitle: { fontSize: 11, color: '#6B7280' },
  deferButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#F3F4F6' },
  deferText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  rebalanceButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 12, marginTop: 14 },
  rebalanceText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  pressed: { opacity: 0.7 },
  resyncBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF9C3', borderRadius: 14, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#FDE047' },
  resyncTitle: { fontSize: 13, fontWeight: '700', color: '#854D0E' },
  resyncSubtext: { fontSize: 11, color: '#713F12' },
  resyncButton: { backgroundColor: '#854D0E', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  resyncButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  /* Modals — centered on screen with internal scroll for long content */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, maxHeight: '85%', maxWidth: '92%', width: 420 },
  modalScrollContent: { paddingBottom: 12 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  modalSubtitle: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  /* Review Modal */
  reviewTaskItem: { backgroundColor: '#FAF8F5', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  reviewRankPill: { backgroundColor: colors.yellowWash, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  reviewRankText: { fontSize: 11, fontWeight: '700', color: colors.brown },
  reviewTaskTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginTop: 6 },
  reviewTaskDetails: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  reviewTaskStress: { fontSize: 12, color: '#B45309', fontWeight: '600', marginTop: 2 },
  reviewTaskReasoning: { fontSize: 11, color: '#4B5563', fontStyle: 'italic', marginTop: 4 },
  reviewEditBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#F8EEDE' },
  reviewEditText: { fontSize: 11, fontWeight: '600', color: colors.brown },
  rejectBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#F3F4F6' },
  rejectBtnText: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  modalActions: { marginTop: 14 },
  primaryModalBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryModalBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  /* Review Editor */
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
  /* Quick Add Modal */
  chatInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, fontSize: 14, minHeight: 60, textAlignVertical: 'top', color: COLORS.text },
  nlpParseButton: { backgroundColor: colors.brown, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  nlpParseButtonText: { color: colors.cream, fontSize: 13, fontWeight: '700' },
  /* Editable Preview */
  previewBox: { backgroundColor: '#F0FDF4', borderRadius: 12, padding: 12, marginTop: 14, borderWidth: 1, borderColor: '#BBF7D0' },
  previewHeader: { fontSize: 11, fontWeight: '700', color: '#166534', letterSpacing: 0.5, marginBottom: 8 },
  previewFieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#E8F5E9' },
  previewFieldLabel: { fontSize: 12, fontWeight: '600', color: '#374151', minWidth: 70 },
  previewFieldHint: { fontSize: 10, color: colors.inkFaint, marginTop: -2, marginBottom: 4, textAlign: 'right' },
  previewInput: { flex: 1, height: 32, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#C8E6C9', borderRadius: 6, paddingHorizontal: 8, fontSize: 12, color: '#1B5E20', textAlign: 'right' },
  previewPriorityRow: { flexDirection: 'row', gap: 6 },
  previewPriorityBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#C8E6C9', backgroundColor: '#FFFFFF' },
  previewPriorityBtnActive: { backgroundColor: '#166534', borderColor: '#166534' },
  previewPriorityBtnText: { fontSize: 10, fontWeight: '700', color: '#374151' },
  previewPriorityBtnTextActive: { color: '#FFFFFF' },
  previewStressValue: { fontSize: 12, fontWeight: '700', color: '#B45309' },
  previewTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  previewDetail: { fontSize: 12, color: '#374151', marginTop: 2 },
});