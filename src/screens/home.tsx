import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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

import { AppModal } from '@/components/base';
import BottomNavigation from '@/components/bottombar';
import { DateChipPicker, TimePicker, endTimeFrom } from '@/components/taskPickers';
import TopNavigation from '@/components/topbar';
import type {
  CalendarConnection,
  LoadBalanceSuggestion,
  SelfReport,
  StressScoreRow,
  TaskAnalysis,
  WeeklyCapacityAnalysis,
} from '@/data/types';
import { demoTodayIndex, isDemoActive } from '@/lib/demoMode';
import { analyzeWeeklyCapacity, parseQuickTasksNLP, suggestLoadBalance } from '@/services/aiService';
import { isNewWeek, updateEventOnDeviceCalendar } from '@/services/calendarSync';
import { formatTaskTime, formatWeekday, toISODate } from '@/services/dateUtils';
import {
  approveTaskAnalysis,
  createAndSyncTask,
  deferTaskAnalysis,
  deleteAndSyncTask,
  getCalendarConnections,
  getTaskAnalyses,
  getWeeklyCapacity,
  listSelfReports,
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
  work: '#FDBA74',
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

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/**
 * Builds the "Early Warning Insight" banner for the stress chart.
 *
 * The copy is driven by the week's peak day and never tells the user to
 * schedule something on a day that has already passed: recovery/rest
 * recommendations are only offered when the peak is today or still ahead.
 */
function buildEarlyWarningInsight(
  dayStress: { score: number; hasData: boolean }[],
  todayIdx: number
): { title: string; icon: 'warning' | 'notifications-active'; urgent: boolean; text: string } {
  const today = dayStress[todayIdx];
  const todayIn = (today?.hasData ?? false) ? (today?.score ?? 0) : null;

  const scored = dayStress
    .map((d, i) => ({ score: d.score, i, hasData: d.hasData }))
    .filter((d) => d.hasData);
  const peak = scored.reduce<{ score: number; i: number } | null>(
    (best, d) => (best === null || d.score > best.score ? { score: d.score, i: d.i } : best),
    null
  );

  const title = 'Early Warning Insight';

  // No real readings at all yet.
  if (!peak) {
    return {
      title,
      icon: 'notifications-active',
      urgent: false,
      text: 'Still building this week\u2019s picture. Add a few tasks or a quick check-in and the stress read gets sharper.',
    };
  }

  const peakDay = WEEKDAY_NAMES[peak.i];
  const peakIsToday = peak.i === todayIdx;
  const peakIsPast = peak.i < todayIdx;
  const urgentToday = todayIn !== null && todayIn >= 60;

  // Today itself is running hot — warn about it before anything else.
  if (urgentToday && !peakIsToday) {
    return {
      title,
      icon: 'warning',
      urgent: true,
      text: `Today is running hot at ${todayIn}/100 while ${peakDay} peaks at ${peak.score}/100. Pull today\u2019s load back and protect some recovery time.`,
    };
  }

  if (peak.score >= 60) {
    if (peakIsToday) {
      return {
        title,
        icon: 'warning',
        urgent: true,
        text: `${peakDay} load is spiking severely at ${peak.score}/100. Make sure tomorrow\u2019s schedule supports active recovery blocks.`,
      };
    }
    if (peakIsPast) {
      return {
        title,
        icon: 'notifications-active',
        urgent: false,
        text: `${peakDay} spiked at ${peak.score}/100. That day has passed \u2014 the week is lighter now, and nothing new needs scheduling.`,
      };
    }
    return {
      title,
      icon: 'notifications-active',
      urgent: false,
      text: `${peakDay} is shaping up to be this week\u2019s peak at ${peak.score}/100. Build a lighter day before it and leave a recovery block after.`,
    };
  }

  // Moderate week — gentle steer, no alarm.
  const todayLead = urgentToday ? `Today is at ${todayIn}/100. ` : '';
  return {
    title,
    icon: 'notifications-active',
    urgent: false,
    text: `${todayLead}This week\u2019s stress is tracking ${peak.score <= 35 ? 'calmly' : 'moderately'} \u2014 keep small recovery moments in the mix.`,
  };
}

export default function Home() {
  const router = useRouter();

  // Core Data State
  const [tasks, setTasks] = useState<TaskAnalysis[]>([]);
  const [capacity, setCapacity] = useState<WeeklyCapacityAnalysis | null>(null);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [loadSuggestions, setLoadSuggestions] = useState<LoadBalanceSuggestion[]>([]);
  const [stressScores, setStressScores] = useState<StressScoreRow[]>([]);
  const [selfReports, setSelfReports] = useState<SelfReport[]>([]);
  const [loading, setLoading] = useState(true);

  // Stress chart interaction
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  // Review Modal for Unapproved Tasks (Current Week)
  const [pendingTasks, setPendingTasks] = useState<TaskAnalysis[]>([]);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [approving, setApproving] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskAnalysis | null>(null);
  // True when the editor was opened from the "This Week Tasks" list rather
  // than from the review modal. Saving then returns to the home page instead
  // of dropping back into the review list (which would read as "stuck").
  const [editingFromList, setEditingFromList] = useState(false);
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);
  // Set right after an edit started from the task list so the reload that
  // follows a save does not immediately re-open the review modal (which made
  // the screen look stuck on the modal the user just dismissed).
  const suppressReviewAutoOpenRef = useRef(false);

  // Quick Add NLP Chatbot Modal State
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; body: string; time: string; read: boolean }>>([]);
  const hasUnread = notifications.some((notification) => !notification.read);
  const [showAddModal, setShowAddModal] = useState(false);
  const [quickInput, setQuickInput] = useState('');
  const [parsingNLP, setParsingNLP] = useState(false);

  const [parsedTasks, setParsedTasks] = useState<Omit<TaskAnalysis, 'id' | 'createdAt'>[]>([]);
  const [editingParsedIdx, setEditingParsedIdx] = useState<number | null>(null);
  const [addingTask, setAddingTask] = useState(false);

  // Sync state
  const [resyncing, setResyncing] = useState(false);

  const currentWeekStart = getWeekStart();

  const loadDashboardData = useCallback(async () => {
    try {
      const [allTasks, currentCapacity, allConns, scores, reports] = await Promise.all([
        getTaskAnalyses(currentWeekStart),
        getWeeklyCapacity(currentWeekStart),
        getCalendarConnections(),
        listStressScores(14),
        listSelfReports(14),
      ]);

      setTasks(allTasks);
      setConnections(allConns);
      setStressScores(scores);
      setSelfReports(reports);

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

      // Check for unapproved / newly synced tasks for this week. The suppress
      // flag is consumed here so it only skips the one reload that follows an
      // edit started from the task list.
      const skipAutoOpen = suppressReviewAutoOpenRef.current;
      suppressReviewAutoOpenRef.current = false;
      const unapproved = allTasks.filter((t) => t.status === 'pending');
      setPendingTasks(unapproved);
      if (unapproved.length > 0 && !skipAutoOpen) {
        setShowReviewModal(true);
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

  // Edit a single pending task's field.
  //
  // Duration is the one field with a knock-on effect: the task's end time is a
  // function of its start time and its length, so changing either recomputes the
  // other here. That single update is what the save path then persists to the
  // database and mirrors to the device calendar, so the calendar block always
  // matches the hours shown in the editor.
  const handleEditField = (field: keyof TaskAnalysis, value: unknown) => {
    setEditingTask((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value } as TaskAnalysis;
      if (field === 'estimated_duration_hours' || field === 'scheduled_start_time') {
        next.scheduled_end_time = endTimeFrom(next.scheduled_start_time, next.estimated_duration_hours);
      }
      return next;
    });
  };

  // Open the inline editor for a task coming from the review modal list.
  const handleStartEditFromReview = (task: TaskAnalysis) => {
    setEditingFromList(false);
    setEditingTask({ ...task });
  };

  // Open the inline editor for a task tapped in the "This Week Tasks" list.
  const handleStartEditFromList = (task: TaskAnalysis) => {
    setEditingFromList(true);
    setEditingTask({ ...task });
    setShowReviewModal(true);
  };

  // Close the editor and return to wherever it was opened from.
  const closeEditor = (fromList: boolean) => {
    setEditingTask(null);
    setEditingFromList(false);
    // Editing a task from the home list returns to the home page; editing from
    // the review modal returns to the review list (or closes it when empty).
    if (fromList || pendingTasks.length === 0) {
      setShowReviewModal(false);
      // A list-originated edit must land back on Home, so block the review
      // modal from auto-opening on the reload that follows.
      suppressReviewAutoOpenRef.current = true;
    }
  };

  // Cancel edit — go back to review list if there are pending tasks, otherwise close modal
  const handleCancelEdit = () => {
    closeEditor(editingFromList);
  };

  // Save edits to a task, persist to the database and sync the device calendar,
  // then return to the home page (task-list edits) or the review list.
  const handleSaveTaskEdit = async () => {
    if (!editingTask) return;
    const fromList = editingFromList;
    setSavingTaskEdit(true);
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
        status: editingTask.status,
      });
      // The device-calendar mirror is best-effort: `updateEventOnDeviceCalendar`
      // already returns `false` rather than throwing when there is no calendar
      // permission or no linked event, so a calendar problem must not roll back a
      // database edit the user has already confirmed.
      await updateEventOnDeviceCalendar(editingTask.calendar_event_id, editingTask);
      setPendingTasks(prev => prev.map(t => t.id === editingTask.id ? editingTask : t));
      closeEditor(fromList);
      await loadDashboardData();
    } catch (err) {
      console.error('Error saving task edit:', err);
      Alert.alert('Error', 'Could not save your changes. Please try again.');
    } finally {
      setSavingTaskEdit(false);
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

  // Quick Add NLP Parser — handles single and multi-task inputs
  const handleParseNLP = async () => {
    if (!quickInput.trim()) return;
    setParsingNLP(true);
    try {
      const parsed = await parseQuickTasksNLP(quickInput, { currentWeekStart });
      setParsedTasks(parsed);
      setEditingParsedIdx(null);
    } catch (err) {
      console.error('Error parsing task input:', err);
    } finally {
      setParsingNLP(false);
    }
  };

  // Confirm Add All Parsed Tasks (Syncs each to Phone Calendar + DB)
  const handleConfirmAddTask = async () => {
    if (parsedTasks.length === 0) return;
    setAddingTask(true);
    try {
      for (const task of parsedTasks) {
        await createAndSyncTask(task);
      }
      setQuickInput('');
      setParsedTasks([]);
      setEditingParsedIdx(null);
      setShowAddModal(false);
      await loadDashboardData();
      Alert.alert(
        'Tasks Created',
        parsedTasks.length === 1
          ? 'Task has been logged and synced to your phone calendar.'
          : `${parsedTasks.length} tasks have been logged and synced to your phone calendar.`
      );
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
    work: tasks.filter((t) => t.category === 'work' && t.status !== 'deferred').length,
    errands: tasks.filter((t) => t.category === 'errands' && t.status !== 'deferred').length,
  };

  // ── Per-day stress synthesis (biometric + self-report + AI task stress) ──
  // A day's stress is a weighted read pulled from the three real signals the
  // app owns — biometric scans, self reports, and the AI's task stress/load
  // analysis — using the same 0.4 / 0.3 / 0.3 weights as fusionService.
  // Days without any signal still place a 0 point on the graph (nothing hidden),
  // but hasData stays false so they never count as the week's peak.
  const WEEK_WEIGHTS = { biometric: 0.4, selfReport: 0.3, aiLoad: 0.3 } as const;
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  // The zero-configuration simulation presents Monday as the current day. Real
  // accounts keep the actual local weekday calculation unchanged.
  const todayIdx = isDemoActive() ? demoTodayIndex() : (new Date().getDay() + 6) % 7; // Mon=0 .. Sun=6
  const weekStartMs = new Date(currentWeekStart + 'T00:00:00').getTime();

  const avgOf = (vals: (number | null)[]) => {
    const real = vals.filter((v): v is number => typeof v === 'number');
    return real.length > 0 ? real.reduce((a, b) => a + b, 0) / real.length : null;
  };

  const dayStress: { score: number; hasData: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(weekStartMs + i * 86400000);
    const dayDateStr = dayDate.toISOString().split('T')[0];

    // 1. Fused rows carry the recorded biometric / self components
    const rowsOnDay = stressScores.filter((s) => {
      const d = new Date(s.createdAt).toISOString().split('T')[0];
      return d === dayDateStr;
    });
    const biometric = avgOf(rowsOnDay.map((s) => s.biometricScore));
    const selfFromRows = avgOf(rowsOnDay.map((s) => s.selfReportScore));
    const fused = avgOf(rowsOnDay.map((s) => s.fusedScore));

    // Self-reports can exist even without a fused snapshot (e.g. baseline day)
    const reportsOnDay = selfReports.filter((s) => {
      const d = new Date(s.createdAt).toISOString().split('T')[0];
      return d === dayDateStr;
    });
    const selfFromReports =
      reportsOnDay.length > 0
        ? reportsOnDay.reduce((a, b) => a + b.score, 0) / reportsOnDay.length
        : null;
    const selfScore = selfFromRows ?? selfFromReports;

    // 2. AI-analyzed stress + load from this day's tasks
    const dayTasks = tasks.filter(
      (t) =>
        t.scheduled_date === dayDateStr &&
        t.status !== 'deferred' &&
        t.status !== 'rejected'
    );
    let aiLoad: number | null = null;
    if (dayTasks.length > 0) {
      const avgTaskStress =
        dayTasks.reduce((acc, t) => acc + (t.stress_score ?? 50), 0) /
        dayTasks.length;
      const dayHours = dayTasks.reduce(
        (acc, t) => acc + (t.estimated_duration_hours || 1),
        0
      );
      aiLoad = Math.min(
        95,
        Math.round(avgTaskStress * 0.55 + Math.min(45, dayHours * 7))
      );
    }

    // 3. Weighted fusion of whichever signals exist for that day
    const signals: { value: number; weight: number }[] = [];
    if (biometric !== null) signals.push({ value: biometric, weight: WEEK_WEIGHTS.biometric });
    if (selfScore !== null) signals.push({ value: selfScore, weight: WEEK_WEIGHTS.selfReport });
    if (aiLoad !== null) signals.push({ value: aiLoad, weight: WEEK_WEIGHTS.aiLoad });

    let score = 0;
    let hasData = signals.length > 0;
    if (signals.length > 0) {
      const weightSum = signals.reduce((a, b) => a + b.weight, 0);
      score = Math.round(
        signals.reduce((a, b) => a + b.value * b.weight, 0) / weightSum
      );
    } else if (fused !== null) {
      // No components were recorded, but a fused snapshot exists — trust it.
      score = Math.round(fused);
      hasData = true;
    }

    dayStress.push({ score, hasData });
  }

  // Build SVG path — every day gets a point (score 0 when no data)
  // Chart area: x 20..365, y 100 (score=0) to 20 (score=100)
  const chartLeft = 20;
  const chartRight = 365;
  const chartTop = 20;
  const chartBottom = 100;
  const xStep = (chartRight - chartLeft) / 6;

  const points = dayStress.map((d, i) => {
    const clampedScore = Math.max(0, Math.min(100, d.score));
    return {
      x: chartLeft + i * xStep,
      y: chartBottom - (clampedScore / 100) * (chartBottom - chartTop),
      score: clampedScore,
      hasData: d.hasData,
      isToday: i === todayIdx,
    };
  });

  // Peak = highest real reading this week (no-data zeros are never the peak)
  const peakIdx = dayStress.reduce(
    (acc, d, i) => (d.hasData && d.score > (acc === -1 ? -1 : dayStress[acc].score) ? i : acc),
    -1
  );

  const stressPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const stressGradientPath =
    stressPath +
    ` L ${points[points.length - 1].x} ${chartBottom} L ${points[0].x} ${chartBottom} Z`;

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
  const todayStress = dayStress[todayIdx];
  const recoveryReminderVisible =
    isOverloaded || (todayStress.hasData && todayStress.score >= 60);

  /** Early Warning Insight copy built from the week's per-day stress */
  const earlyWarning = buildEarlyWarningInsight(dayStress, todayIdx);

  return (
    // Only the top edge — the shared Screen does the same, so the bottom nav
    // sits flush at the screen bottom on every tab instead of floating above
    // the device's home-indicator inset on Home alone.
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={styles.container}>
        <TopNavigation />

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
            <View
              style={styles.chartContainer}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0) setChartWidth(w);
              }}
            >
              <View style={styles.chartFrame}>
                {/*
                 * `preserveAspectRatio="none"` is what keeps the plotted points
                 * aligned with the day labels underneath.
                 *
                 * The chart is drawn in a fixed 380x120 viewBox but rendered at
                 * 100% of a container whose width is only known at runtime. SVG's
                 * default (`xMidYMid meet`) fits the viewBox inside the box while
                 * preserving its aspect ratio, so at any width where
                 * width/height != 380/120 the drawing is scaled down and centred
                 * with letterboxing — the grid lines and every data point then sit
                 *inside* the frame, shifted away from the day labels, which are
                 * laid out against the full container width by the daysRow below.
                 * Stretching the viewBox to exactly fill the frame makes the SVG's
                 * x axis identical to the container's, which is the coordinate
                 * space the label row and the tap zones already use.
                 */}
                <Svg
                  height="120"
                  width="100%"
                  viewBox="0 0 380 120"
                  preserveAspectRatio="none"
                >
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
                  <Path d={stressGradientPath} fill="url(#stressGradient)" />

                  {/* Line */}
                  <Path
                    d={stressPath}
                    stroke="#7c5730"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />

                  {/* Data points — every day has one; peak + today highlighted */}
                  {points.map((p, i) => {
                    const isPeak = i === peakIdx && p.hasData;
                    const isSelected = i === selectedDayIdx;
                    return (
                      <Circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={isPeak ? 6 : isSelected ? 4.5 : p.hasData ? 4 : 3}
                        fill={
                          isPeak
                            ? '#ba1a1a'
                            : isSelected
                              ? '#E07A5F'
                              : p.hasData
                                ? '#7c5730'
                                : '#FFFFFF'
                        }
                        stroke={
                          isPeak || isSelected
                            ? '#ffffff'
                            : p.hasData
                              ? '#7c5730'
                              : '#B8B0A4'
                        }
                        strokeWidth={isPeak ? 2.5 : 1.5}
                      />
                    );
                  })}
                </Svg>

                {/* Tap zones — one column per day, tap to reveal the exact score */}
                {chartWidth > 0 &&
                  points.map((p, i) => {
                    // Mini tap targets span a whole day column; the hitSlop below
                    // grows the touch area beyond the visual dot without
                    // overlapping its neighbours.
                    const zoneW = Math.max(18, (chartWidth / 380) * xStep);
                    const left = Math.min(
                      Math.max(0, (p.x / 380) * chartWidth - zoneW / 2),
                      Math.max(0, chartWidth - zoneW)
                    );
                    return (
                      <Pressable
                        key={`tap-${i}`}
                        onPress={() => setSelectedDayIdx(selectedDayIdx === i ? null : i)}
                        style={[styles.tapZone, { left, width: zoneW }]}
                        hitSlop={4}
                      />
                    );
                  })}

                {/* Tooltip with the exact score for the tapped day */}
                {selectedDayIdx !== null && points[selectedDayIdx] && chartWidth > 0 && (
                  <View
                    style={[
                      styles.tooltip,
                      {
                        left: Math.max(
                          6,
                          Math.min(
                            (points[selectedDayIdx].x / 380) * chartWidth - 46,
                            chartWidth - 98
                          )
                        ),
                      },
                    ]}
                  >
                    <Text style={styles.tooltipDay}>{WEEKDAY_NAMES[selectedDayIdx]}</Text>
                    <Text style={styles.tooltipScore}>
                      {points[selectedDayIdx].score}
                      <Text style={styles.tooltipUnit}> /100</Text>
                    </Text>
                    {!points[selectedDayIdx].hasData && (
                      <Text style={styles.tooltipNote}>no data yet</Text>
                    )}
                  </View>
                )}
              </View>

              <View style={styles.daysRow}>
                {dayLabels.map((label, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dayLabelWrap,
                      { left: `${(points[i].x / 380) * 100}%` },
                      i === todayIdx && styles.dayLabelWrapActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        i === todayIdx && styles.dayTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Early Warning Banner */}
            <View style={[styles.insightBanner, earlyWarning.urgent && styles.insightBannerUrgent]}>
              <View style={styles.insightIconContainer}>
                <MaterialIcons
                  name={earlyWarning.urgent ? 'warning' : 'notifications-active'}
                  size={18}
                  color={earlyWarning.urgent ? '#DC2626' : '#E07A5F'}
                />
              </View>
              <View style={styles.insightContent}>
                <Text style={[styles.insightTitle, earlyWarning.urgent && styles.insightTitleUrgent]}>
                  {earlyWarning.title}
                </Text>
                <Text style={styles.insightText}>{earlyWarning.text}</Text>
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

              {/* Legend with Real Category Percentages — only show categories > 0% */}
              <View style={styles.legendContainer}>
                {academicPct > 0 && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: COLORS.academic }]} />
                    <Text style={styles.legendText}>Academic ({academicPct}%)</Text>
                  </View>
                )}
                {workPct > 0 && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#FCD34D' }]} />
                    <Text style={styles.legendText}>Work ({workPct}%)</Text>
                  </View>
                )}
                {socialPct > 0 && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: COLORS.social }]} />
                    <Text style={styles.legendText}>Social ({socialPct}%)</Text>
                  </View>
                )}
                {physicalPct > 0 && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: COLORS.physical }]} />
                    <Text style={styles.legendText}>Physical ({physicalPct}%)</Text>
                  </View>
                )}
                {errandsPct > 0 && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: COLORS.errands }]} />
                    <Text style={styles.legendText}>Errands ({errandsPct}%)</Text>
                  </View>
                )}
                {mentalPct > 0 && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: COLORS.mental }]} />
                    <Text style={styles.legendText}>Mental ({mentalPct}%)</Text>
                  </View>
                )}
                {usedHours === 0 && (
                  <Text style={[styles.legendText, { color: '#9CA3AF', fontStyle: 'italic' }]}>No tasks scheduled yet</Text>
                )}
              </View>
            </View>
          </View>

          {/* 3. Categorized Load Map */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Categorized Load Map</Text>
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
              <CategoryCard
                emoji="💼"
                title="Work"
                description="Projects, Tasks & Meetings"
                badge={`${categoryCounts.work} Tasks`}
                background="#FFF7ED"
                border="#FED7AA"
                badgeBackground="#FED7AA"
                badgeColor="#C2410C"
              />
              <CategoryCard
                  emoji="🛒"
                  title="Others & Errands"
                  description="Chores & Misc"
                  badge={`${categoryCounts.errands} Items`}
                  background="#FDF2F4"
                  border="#FBCFE8"
                  badgeBackground="#FCE7F3"
                  badgeColor="#DB2777"
                />
            </View>
          </View>

          {/* 4. AI Ranked Tasks for This Week (Tap card to toggle done/strikethrough) */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>This Week Tasks</Text>
              <Pressable onPress={() => setShowAddModal(true)} style={styles.addInlineButton}>
                <MaterialIcons name="add" size={16} color={COLORS.primary} />
                <Text style={styles.addInlineText}>Quick Add</Text>
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
                          {formatTaskTime(task.scheduled_start_time)
                            ? ` • ${formatTaskTime(task.scheduled_start_time)}`
                            : ''}
                          {task.scheduled_date
                            ? ` • ${formatWeekday(task.scheduled_date) ?? task.scheduled_date}`
                            : ''}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        handleStartEditFromList(task);
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

          <View style={{ height: 20 }} />
        </ScrollView>

        {/* Bottom Navigation */}
        <BottomNavigation activeTab="Home" router={router} />
      </View>

      {/* ── AI REVIEW MODAL (Triggered for newly synced weekly tasks) ─────── */}
      <AppModal
        visible={showReviewModal}
        onRequestClose={editingTask ? handleCancelEdit : () => setShowReviewModal(false)}
        maxWidth={420}
      >
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
                <Pressable onPress={handleCancelEdit} hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="close" size={22} color={colors.inkSoft} />
                </Pressable>
              )}
            </View>

            {editingTask ? (
              /* ── Inline Task Editor ───
               * The duration stepper writes `estimated_duration_hours` through
               * handleEditField, which recomputes `scheduled_end_time` from the
               * start time — so the block drawn on the phone calendar grows and
               * shrinks with the hours, and Save persists both. */
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
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
                          style={[
                            styles.pickerChip,
                            editingTask.category === key && styles.pickerChipActive,
                          ]}
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
                    <Text style={styles.reviewEditorReasoning}>{editingTask.ai_reasoning}</Text>
                  ) : null}

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                    <Pressable onPress={handleCancelEdit} style={styles.reviewCancelBtn}>
                      <Text style={styles.reviewCancelBtnText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSaveTaskEdit}
                      disabled={savingTaskEdit}
                      style={[styles.reviewSaveBtn, savingTaskEdit && { opacity: 0.7 }]}
                    >
                      {savingTaskEdit ? (
                        <ActivityIndicator size="small" color={colors.cream} />
                      ) : (
                        <Text style={styles.reviewSaveBtnText}>Save Changes</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            ) : (
              /* ── Task List View ─── */
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                showsVerticalScrollIndicator={false}
              >
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
                        <Pressable onPress={() => handleStartEditFromReview(task)} style={styles.reviewEditBtn}>
                          <Ionicons name="pencil" size={14} color={colors.brown} />
                          <Text style={styles.reviewEditText}>Edit</Text>
                        </Pressable>
                      </View>
                    </View>
                    <Text style={styles.reviewTaskTitle}>{task.title}</Text>
                    <Text style={styles.reviewTaskDetails}>
                      {task.category} • {task.estimated_duration_hours}h •{' '}
                      {formatWeekday(task.scheduled_date) ?? task.scheduled_date}{' '}
                      {formatTaskTime(task.scheduled_start_time) || 'All Day'}
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
      </AppModal>

      {/* ── QUICK ADD NLP CHATBOT MODAL (2-Way Calendar Sync) ─────────────── */}
      <AppModal
        visible={showAddModal}
        onRequestClose={() => setShowAddModal(false)}
        maxWidth={420}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ width: '100%' }}
        >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>
                    {editingParsedIdx !== null ? 'Edit Task' : 'Quick Task Logger'}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {editingParsedIdx !== null
                      ? 'Adjust details and tap Save'
                      : parsedTasks.length > 0
                        ? `${parsedTasks.length} task${parsedTasks.length > 1 ? 's' : ''} detected — review below`
                        : 'From words to tasks. Instantly.'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    if (editingParsedIdx !== null) {
                      setEditingParsedIdx(null);
                    } else {
                      setShowAddModal(false);
                      setParsedTasks([]);
                      setQuickInput('');
                    }
                  }}
                  hitSlop={8}
                  style={{ padding: 4 }}
                >
                  <Ionicons name={editingParsedIdx !== null ? 'arrow-back' : 'close'} size={22} color={colors.inkSoft} />
                </Pressable>
              </View>

              {editingParsedIdx !== null ? (
                /* ── Step 3: Edit one parsed task ─── */
                (() => {
                  const task = parsedTasks[editingParsedIdx];
                  // Same knock-on rule as the review editor: the end time follows
                  // the duration (and the start time), so the value handed to
                  // createAndSyncTask — and therefore the device-calendar event —
                  // matches the hours the user just set.
                  const updateField = (field: string, value: unknown) => {
                    setParsedTasks(prev => prev.map((t, i) => {
                      if (i !== editingParsedIdx) return t;
                      const next = { ...t, [field]: value } as Omit<TaskAnalysis, 'id' | 'createdAt'>;
                      if (field === 'estimated_duration_hours' || field === 'scheduled_start_time') {
                        next.scheduled_end_time = endTimeFrom(next.scheduled_start_time, next.estimated_duration_hours);
                      }
                      return next;
                    }));
                  };
                  return (
                    <ScrollView
                      style={styles.modalScroll}
                      contentContainerStyle={styles.modalScrollContent}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                    >
                      <View style={styles.reviewEditorCard}>
                        {/* Title */}
                        <View style={styles.reviewEditorField}>
                          <Text style={styles.reviewEditorLabel}>Title</Text>
                          <TextInput
                            style={styles.reviewEditorInput}
                            value={task.title}
                            onChangeText={(v) => updateField('title', v)}
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
                                onPress={() => updateField('category', key)}
                                style={[styles.pickerChip, task.category === key && styles.pickerChipActive]}
                              >
                                <Text style={[styles.pickerChipText, task.category === key && styles.pickerChipTextActive]}>
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
                            {(['high', 'medium', 'low'] as const).map(p => (
                              <Pressable
                                key={p}
                                onPress={() => updateField('priority', p)}
                                style={[styles.reviewPriorityBtn, task.priority === p && styles.reviewPriorityBtnActive]}
                              >
                                <Text style={[styles.reviewPriorityBtnText, task.priority === p && { color: colors.cream }]}>
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
                              onPress={() => updateField('estimated_duration_hours', Math.max(0.5, (task.estimated_duration_hours || 1) - 0.5))}
                              style={styles.stepperBtn}
                            >
                              <Text style={styles.stepperBtnText}>−</Text>
                            </Pressable>
                            <Text style={styles.stepperValue}>{task.estimated_duration_hours}h</Text>
                            <Pressable
                              onPress={() => updateField('estimated_duration_hours', Math.min(12, (task.estimated_duration_hours || 1) + 0.5))}
                              style={styles.stepperBtn}
                            >
                              <Text style={styles.stepperBtnText}>+</Text>
                            </Pressable>
                          </View>
                        </View>

                        {/* Date Chips */}
                        <View style={[styles.reviewEditorField, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                          <Text style={[styles.reviewEditorLabel, { marginBottom: 8 }]}>Date</Text>
                          <DateChipPicker
                            key={`parsed-${editingParsedIdx}-date`}
                            value={task.scheduled_date}
                            onChange={(v) => updateField('scheduled_date', v)}
                          />
                        </View>

                        {/* Time Chips */}
                        <View style={[styles.reviewEditorField, { flexDirection: 'column', alignItems: 'flex-start' }]}>
                          <Text style={[styles.reviewEditorLabel, { marginBottom: 8 }]}>Start Time</Text>
                          <TimePicker
                            key={`parsed-${editingParsedIdx}-time`}
                            value={task.scheduled_start_time}
                            onChange={(v) => updateField('scheduled_start_time', v)}
                          />
                        </View>

                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                          <Pressable onPress={() => setEditingParsedIdx(null)} style={styles.reviewCancelBtn}>
                            <Text style={styles.reviewCancelBtnText}>Back</Text>
                          </Pressable>
                          <Pressable onPress={() => setEditingParsedIdx(null)} style={styles.reviewSaveBtn}>
                            <Text style={styles.reviewSaveBtnText}>Done</Text>
                          </Pressable>
                        </View>
                      </View>
                    </ScrollView>
                  );
                })()
              ) : (
                /* ── Step 1 & 2: Input + Card Review ─── */
                <ScrollView
                  style={styles.modalScroll}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.modalScrollContent}
                >
                  {parsedTasks.length === 0 && (
                    <>
                      <TextInput
                        style={styles.chatInput}
                        placeholder={'e.g. "exam Fri 2pm, Travel Sunday, Gym 3pm"\nor "2 assignment due Fri"'}
                        placeholderTextColor={colors.inkFaint}
                        value={quickInput}
                        onChangeText={setQuickInput}
                        multiline
                        scrollEnabled={false}
                      />
                      <Pressable
                        onPress={handleParseNLP}
                        disabled={parsingNLP || !quickInput.trim()}
                        style={[styles.nlpParseButton, (!quickInput.trim() || parsingNLP) && { opacity: 0.6 }]}
                      >
                        {parsingNLP ? (
                          <ActivityIndicator size="small" color={colors.cream} />
                        ) : (
                          <Text style={styles.nlpParseButtonText}>Analyze →</Text>
                        )}
                      </Pressable>
                    </>
                  )}

                  {/* Step 2: Brief task cards */}
                  {parsedTasks.length > 0 && (
                    <>
                      <Text style={styles.previewHeader}>
                        {parsedTasks.length === 1 ? 'TASK DETECTED' : `${parsedTasks.length} TASKS DETECTED`}
                      </Text>
                      {parsedTasks.map((task, idx) => {
                        const catEmoji = getCategoryEmoji(task.category);
                        const priorityStyle = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;
                        const timeLabel = formatTaskTime(task.scheduled_start_time)
                          ? (() => {
                              const time = formatTaskTime(task.scheduled_start_time)!;
                              const h = parseInt(time.split(':')[0], 10);
                              const m = time.split(':')[1];
                              return h < 12 ? `${h}:${m}am` : h === 12 ? `12:${m}pm` : `${h - 12}:${m}pm`;
                            })()
                          : 'All Day';
                        return (
                          <View key={idx} style={styles.parsedTaskCard}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                                <View style={styles.reviewRankPill}>
                                  <Text style={styles.reviewRankText}>#{task.rank ?? idx + 1}</Text>
                                </View>
                                <Text style={{ fontSize: 16 }}>{catEmoji}</Text>
                                <Text style={styles.parsedTaskTitle} numberOfLines={1}>{task.title}</Text>
                              </View>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <View style={[styles.priorityPill, { backgroundColor: priorityStyle.bg, borderColor: priorityStyle.border }]}>
                                  <Text style={[styles.pillText, { color: priorityStyle.text }]}>{task.priority.toUpperCase()}</Text>
                                </View>
                                <Pressable
                                  onPress={() => setEditingParsedIdx(idx)}
                                  style={styles.reviewEditBtn}
                                >
                                  <Ionicons name="pencil" size={13} color={colors.brown} />
                                  <Text style={styles.reviewEditText}>Edit</Text>
                                </Pressable>
                              </View>
                            </View>
                            <Text style={styles.parsedTaskMeta}>
                              {task.category} • {task.estimated_duration_hours}h •{' '}
                              {formatWeekday(task.scheduled_date) ?? task.scheduled_date} • {timeLabel}
                            </Text>
                            <Pressable
                              onPress={() => setParsedTasks(prev => prev.filter((_, i) => i !== idx))}
                              style={styles.parsedTaskRemoveBtn}
                            >
                              <Text style={styles.parsedTaskRemoveText}>Remove</Text>
                            </Pressable>
                          </View>
                        );
                      })}

                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                        <Pressable
                          onPress={() => { setParsedTasks([]); }}
                          style={styles.reviewCancelBtn}
                        >
                          <Text style={styles.reviewCancelBtnText}>Start Over</Text>
                        </Pressable>
                        <Pressable
                          onPress={handleConfirmAddTask}
                          disabled={addingTask || parsedTasks.length === 0}
                          style={[styles.reviewSaveBtn, (addingTask || parsedTasks.length === 0) && { opacity: 0.7 }]}
                        >
                          {addingTask ? (
                            <ActivityIndicator size="small" color={colors.cream} />
                          ) : (
                            <Text style={styles.reviewSaveBtnText}>
                              {parsedTasks.length === 1 ? 'Add Task →' : `Add ${parsedTasks.length} Tasks →`}
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    </>
                  )}
                </ScrollView>
              )}
            </View>
        </KeyboardAvoidingView>
      </AppModal>

      {/* ── NOTIFICATIONS MODAL ─────────────────────────────────────────────── */}
      {false && (<Modal visible={false} transparent animationType="fade" onRequestClose={() => setShowNotifications(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Notifications</Text>
                <Text style={styles.modalSubtitle}>
                  {hasUnread
                    ? `${notifications.filter(n => !n.read).length} unread — tap one to mark it read`
                    : 'All caught up'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {hasUnread && (
                  <Pressable
                    onPress={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}
                    style={({ pressed }) => [styles.notifMarkAllBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.notifMarkAllText}>Mark all read</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setShowNotifications(false)} hitSlop={8} style={{ padding: 4 }}>
                  <Ionicons name="close" size={22} color={colors.inkSoft} />
                </Pressable>
              </View>
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {notifications.length === 0 ? (
                <Text style={styles.notifEmpty}>No notifications yet.</Text>
              ) : (
                notifications.map((notif) => (
                  <Pressable
                    key={notif.id}
                    onPress={() => setNotifications(prev => prev.map(n => (n.id === notif.id ? { ...n, read: true } : n)))}
                    style={({ pressed }) => [
                      styles.notifItem,
                      !notif.read && styles.notifItemUnread,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.notifDotWrap}>
                      {!notif.read && <View style={styles.notifUnreadDot} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={styles.notifTitle} numberOfLines={1}>{notif.title}</Text>
                        <Text style={styles.notifTime}>{notif.time}</Text>
                      </View>
                      <Text style={styles.notifBody}>{notif.body}</Text>
                    </View>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>)}
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
  chartContainer: { alignItems: 'center', marginBottom: 12, width: '100%' },
  chartFrame: { width: '100%', height: 120 },
  tapZone: { position: 'absolute', top: 0, bottom: 0 },
  tooltip: {
    position: 'absolute',
    top: 2,
    backgroundColor: colors.brown,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
    minWidth: 92,
    zIndex: 5,
    elevation: 4,
  },
  tooltipDay: {
    color: '#F8EEDE',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tooltipScore: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  tooltipUnit: { fontSize: 10, color: '#F8EEDE', fontWeight: '600' },
  tooltipNote: { fontSize: 9, color: '#F8EEDE', fontStyle: 'italic', marginTop: 1 },
  /* The labels use the exact same x coordinate as their SVG points. The first
     and last points are inset at 20/380 and 365/380 of the chart width, so each
     label is positioned from that same viewBox coordinate instead of using flex
     columns (which would put their centres at different x values). */
  daysRow: {
    position: 'relative',
    width: '100%',
    height: 24,
    marginTop: 8,
  },
  dayLabelWrap: {
    position: 'absolute',
    top: 0,
    width: 28,
    marginLeft: -14,
    alignItems: 'center',
  },
  dayLabelWrapActive: {
    backgroundColor: colors.yellow,
    borderRadius: 50,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  dayText: { fontSize: 13, color: '#81756C', fontWeight: '500' },
  dayTextActive: { color:'#81756C', fontWeight: '700' },
  insightBanner: { flexDirection: 'row', backgroundColor: '#FFF5F0', borderRadius: 12, padding: 12, marginTop: 4 },
  insightBannerUrgent: { backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FECACA' },
  insightIconContainer: { marginRight: 8, marginTop: 2 },
  insightContent: { flex: 1 },
  insightTitle: { fontSize: 14, fontWeight: '700', color: '#E07A5F', marginBottom: 2 },
  insightTitleUrgent: { color: '#DC2626' },
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
  legendContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, justifyContent: 'center' },
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
  deferButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#FDF1A9' },
  deferText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  rebalanceButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 12, marginTop: 14 },
  rebalanceText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  pressed: { opacity: 0.7 },
  resyncBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF9C3', borderRadius: 14, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#FDE047' },
  resyncTitle: { fontSize: 13, fontWeight: '700', color: '#854D0E' },
  resyncSubtext: { fontSize: 11, color: '#713F12' },
  resyncButton: { backgroundColor: '#854D0E', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  resyncButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  /* Modals — AppModal owns the centring and the height cap; this is just the
     card. `width: '100%'` + no fixed height lets it fill the (already padded and
     capped) modal box and shrink to its content, so a short dialog stays small
     and a tall one scrolls internally instead of being clipped. */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    width: '100%',
    /*
     * `flexShrink` lets the card give space back to the scroll region instead of
     * pushing past the modal's height cap. Without it a form taller than the cap
     * overflowed its own clipping box and the Save row at the bottom became
     * unreachable; the inner ScrollView below is what then absorbs the overflow.
     */
    flexShrink: 1,
  },
  /* The scroll region inside a modal: it grows with its content and only starts
     scrolling once the card has hit AppModal's maxHeight, so short dialogs show
     everything at once (no stray inner scrollbar). */
  modalScroll: { flexGrow: 0, flexShrink: 1 },
  modalScrollContent: { paddingBottom: 12 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  modalSubtitle: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  /* Notifications Modal */
  notifItem: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#FAF8F5', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  notifItemUnread: { backgroundColor: colors.yellowWash, borderColor: colors.yellowDeep },
  notifDotWrap: { width: 16, alignItems: 'center', paddingTop: 5 },
  notifUnreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E07A5F' },
  notifTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text, flexShrink: 1 },
  notifTime: { fontSize: 11, color: '#6B7280', marginLeft: 8 },
  notifBody: { fontSize: 12, color: '#6B7280', marginTop: 3, lineHeight: 17 },
  notifMarkAllBtn: { backgroundColor: colors.brownSoft, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  notifMarkAllText: { fontSize: 12, fontWeight: '700', color: colors.brown },
  notifEmpty: { fontSize: 13, color: '#6B7280', fontStyle: 'italic', textAlign: 'center', paddingVertical: 24 },
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
  chatInput: { backgroundColor: '#FAF8F5', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, fontSize: 14, minHeight: 70, textAlignVertical: 'top', color: COLORS.text },
  nlpParseButton: { backgroundColor: colors.brown, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  nlpParseButtonText: { color: colors.cream, fontSize: 13, fontWeight: '700' },
  /* previewHeader reused for multi-task detected label */
  previewHeader: { fontSize: 11, fontWeight: '700', color: colors.brown, letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },
  previewStressValue: { fontSize: 12, fontWeight: '700', color: '#B45309' },
  /* Parsed task cards — brief card in multi-task review */
  parsedTaskCard: { backgroundColor: '#FAF8F5', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  parsedTaskTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text, flex: 1 },
  parsedTaskMeta: { fontSize: 12, color: '#6B7280', marginBottom: 6 },
  parsedTaskRemoveBtn: { alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, backgroundColor: '#F3F4F6' },
  parsedTaskRemoveText: { fontSize: 11, color: '#9CA3AF', fontWeight: '600' },
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
  stepperBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.yellowWash, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  stepperBtnText: { fontSize: 18, fontWeight: '700', color: colors.brown, lineHeight: 22 },
  stepperValue: { fontSize: 15, fontWeight: '700', color: COLORS.text, minWidth: 36, textAlign: 'center' },
});