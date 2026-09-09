import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import BottomNavigation from '@/components/bottombar';
import TopNavigation from '@/components/topbar';
import type {
    CalendarConnection,
    LoadBalanceSuggestion,
    TaskAnalysis,
    WeeklyCapacityAnalysis,
} from '@/data/types';
import { parseQuickTaskNLP, suggestLoadBalance } from '@/services/aiService';
import { isNewWeek } from '@/services/calendarSync';
import {
    approveTaskAnalysis,
    createAndSyncTask,
    deferTaskAnalysis,
    deleteAndSyncTask,
    getCalendarConnections,
    getTaskAnalyses,
    getWeeklyCapacity,
    syncAndAnalyzeCalendar
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
  return d.toISOString().split('T')[0];
}

export default function Home() {
  const router = useRouter();

  // Core Data State
  const [tasks, setTasks] = useState<TaskAnalysis[]>([]);
  const [capacity, setCapacity] = useState<WeeklyCapacityAnalysis | null>(null);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [loadSuggestions, setLoadSuggestions] = useState<LoadBalanceSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  // Review Modal for Unapproved Tasks (Current Week)
  const [pendingTasks, setPendingTasks] = useState<TaskAnalysis[]>([]);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [approving, setApproving] = useState(false);

  // Quick Add NLP Chatbot Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [quickInput, setQuickInput] = useState('');
  const [parsingNLP, setParsingNLP] = useState(false);
  const [parsedPreview, setParsedPreview] = useState<Omit<TaskAnalysis, 'id' | 'createdAt'> | null>(null);
  const [addingTask, setAddingTask] = useState(false);

  // Sync state
  const [resyncing, setResyncing] = useState(false);

  const currentWeekStart = getWeekStart();

  const loadDashboardData = useCallback(async () => {
    try {
      const [allTasks, currentCapacity, allConns] = await Promise.all([
        getTaskAnalyses(currentWeekStart),
        getWeeklyCapacity(currentWeekStart),
        getCalendarConnections(),
      ]);

      setTasks(allTasks);
      setCapacity(currentCapacity);
      setConnections(allConns);

      // Check for unapproved / newly synced tasks for this week
      const unapproved = allTasks.filter((t) => t.status === 'pending');
      if (unapproved.length > 0) {
        setPendingTasks(unapproved);
        setShowReviewModal(true);
      } else {
        setPendingTasks([]);
      }

      // Generate AI Load Balance Suggestions
      const suggestions = await suggestLoadBalance(allTasks, currentCapacity || undefined);
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
      Alert.alert('Calendar Synced', `Found and analyzed ${res.tasksCreated} task(s) for this week.`);
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
      setPendingTasks((prev) => prev.filter((p) => p.id !== id));
      await loadDashboardData();
    } catch (err) {
      console.error('Error rejecting task:', err);
    }
  };

  // Quick Add NLP Parser
  const handleParseNLP = async () => {
    if (!quickInput.trim()) return;
    setParsingNLP(true);
    try {
      const parsed = await parseQuickTaskNLP(quickInput);
      setParsedPreview(parsed);
    } catch (err) {
      console.error('Error parsing task input:', err);
    } finally {
      setParsingNLP(false);
    }
  };

  // Confirm Add Task (Syncs to Phone Calendar + DB)
  const handleConfirmAddTask = async () => {
    if (!parsedPreview) return;
    setAddingTask(true);
    try {
      await createAndSyncTask(parsedPreview);
      setQuickInput('');
      setParsedPreview(null);
      setShowAddModal(false);
      await loadDashboardData();
      Alert.alert('Task Created', 'Task has been logged and synced to your phone calendar.');
    } catch (err: any) {
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
      await loadDashboardData();
      Alert.alert('Rebalance Applied', 'Low-priority tasks deferred to relieve this week’s workload.');
    } catch (err) {
      console.error('Error applying smart rebalance:', err);
    }
  };

  // Calculate Category Counts
  const categoryCounts = {
    academic: tasks.filter((t) => t.category === 'academic').length,
    social: tasks.filter((t) => t.category === 'social').length,
    physical: tasks.filter((t) => t.category === 'physical').length,
    mental: tasks.filter((t) => t.category === 'mental').length,
    errands: tasks.filter((t) => t.category === 'errands' || t.category === 'work').length,
  };

  const usedHours = capacity?.used_capacity_hours ?? 0;
  const totalHours = capacity?.total_capacity_hours ?? 40;
  const capacityPct = Math.min(100, Math.round((usedHours / totalHours) * 100));
  const isOverloaded = capacity?.overload_warning || capacityPct >= 85;

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

                <Line x1="10" y1="20" x2="370" y2="20" stroke="#f2eede" strokeWidth="1" strokeDasharray="4 4" />
                <Line x1="10" y1="60" x2="370" y2="60" stroke="#f2eede" strokeWidth="1" strokeDasharray="4 4" />
                <Line x1="10" y1="100" x2="370" y2="100" stroke="#f2eede" strokeWidth="1" />

                <Path
                  d="M 20 85 C 50 82, 60 70, 80 68 C 110 65, 120 22, 140 16 C 160 12, 180 50, 200 55 C 230 62, 240 75, 260 78 C 290 82, 300 92, 320 90 C 340 88, 355 85, 365 85 L 365 100 L 20 100 Z"
                  fill="url(#stressGradient)"
                />

                <Path
                  d="M 20 85 C 50 82, 60 70, 80 68 C 110 65, 120 22, 140 16 C 160 12, 180 50, 200 55 C 230 62, 240 75, 260 78 C 290 82, 300 92, 320 90 C 340 88, 355 85, 365 85"
                  stroke="#7c5730"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />

                <Circle cx="140" cy="16" r="6" fill="#ba1a1a" stroke="#ffffff" strokeWidth="2.5" />
                <Circle cx="20" cy="85" r="3" fill="#81756c" />
                <Circle cx="80" cy="68" r="3" fill="#81756c" />
                <Circle cx="200" cy="55" r="3" fill="#81756c" />
                <Circle cx="260" cy="78" r="3" fill="#81756c" />
                <Circle cx="320" cy="90" r="3" fill="#81756c" />
                <Circle cx="365" cy="85" r="3" fill="#81756c" />
              </Svg>

              <View style={styles.daysRow}>
                <Text style={styles.dayText}>M</Text>
                <Text style={styles.dayText}>T</Text>
                <View style={styles.activeDayBadge}>
                  <Text style={styles.activeDayText}>W</Text>
                </View>
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
                  {isOverloaded ? 'Cognitive Load Warning' : 'AI Workload Insight'}
                </Text>
                <Text style={styles.insightText}>
                  {capacity?.ai_reasoning ||
                    'Your weekly cognitive load is being tracked from active calendar events and baseline metrics.'}
                </Text>
              </View>
            </View>
          </View>

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
              {/* Category Breakdown Bar */}
              <View style={styles.capacityBar}>
                <View style={[styles.capacitySegment, { width: `${capacity?.category_breakdown?.academic || 35}%`, backgroundColor: COLORS.academic }]} />
                <View style={[styles.capacitySegment, { width: `${capacity?.category_breakdown?.social || 20}%`, backgroundColor: COLORS.social }]} />
                <View style={[styles.capacitySegment, { width: `${capacity?.category_breakdown?.physical || 15}%`, backgroundColor: COLORS.physical }]} />
                <View style={[styles.capacitySegment, { width: `${capacity?.category_breakdown?.errands || 15}%`, backgroundColor: COLORS.errands }]} />
                <View style={[styles.capacitySegment, { width: `${capacity?.category_breakdown?.mental || 15}%`, backgroundColor: COLORS.mental }]} />
              </View>

              {/* Legend */}
              <View style={styles.legendContainer}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.academic }]} />
                  <Text style={styles.legendText}>Academic ({capacity?.category_breakdown?.academic ?? 35}%)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.social }]} />
                  <Text style={styles.legendText}>Social ({capacity?.category_breakdown?.social ?? 20}%)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.physical }]} />
                  <Text style={styles.legendText}>Physical ({capacity?.category_breakdown?.physical ?? 15}%)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.errands }]} />
                  <Text style={styles.legendText}>Errands ({capacity?.category_breakdown?.errands ?? 15}%)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.mental }]} />
                  <Text style={styles.legendText}>Mental ({capacity?.category_breakdown?.mental ?? 15}%)</Text>
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

          {/* 4. AI Ranked Tasks for This Week (with Delete -> 2-way sync) */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>AI Ranked Tasks (This Week)</Text>
              <Pressable onPress={() => setShowAddModal(true)} style={styles.iconButton}>
                <MaterialIcons name="add-circle" size={24} color={COLORS.primary} />
              </Pressable>
            </View>

            {tasks.length === 0 ? (
              <View style={styles.emptyTasks}>
                <Text style={styles.emptyTasksText}>No tasks logged for this week.</Text>
                <Pressable onPress={() => setShowAddModal(true)} style={styles.addFirstTaskBtn}>
                  <Text style={styles.addFirstTaskText}>+ Quick Add with AI</Text>
                </Pressable>
              </View>
            ) : (
              tasks.map((task) => (
                <View key={task.id} style={styles.taskCard}>
                  <View style={styles.taskRankBadge}>
                    <Text style={styles.taskRankText}>#{task.rank}</Text>
                  </View>
                  <View style={styles.taskBody}>
                    <Text style={styles.taskTitleText}>{task.title}</Text>
                    <View style={styles.taskTagsRow}>
                      <View style={[styles.priorityPill, task.priority === 'high' ? styles.pillHigh : task.priority === 'medium' ? styles.pillMed : styles.pillLow]}>
                        <Text style={styles.pillText}>{task.priority.toUpperCase()}</Text>
                      </View>
                      <Text style={styles.taskSubDetail}>
                        {task.category} • {task.estimated_duration_hours}h • {task.scheduled_date} {task.scheduled_start_time || ''}
                      </Text>
                    </View>
                  </View>
                  <Pressable onPress={() => handleDeleteTask(task)} style={styles.deleteButton} hitSlop={8}>
                    <MaterialIcons name="delete-outline" size={20} color="#9CA3AF" />
                  </Pressable>
                </View>
              ))
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
                ? 'AI recommends deferring these lower-priority tasks to relieve cognitive pressure this week:'
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
      <Modal visible={showReviewModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>AI Workload Review</Text>
                <Text style={styles.modalSubtitle}>
                  Current week tasks auto-detected from your native calendar
                </Text>
              </View>
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {pendingTasks.map((task) => (
                <View key={task.id} style={styles.reviewTaskItem}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={styles.reviewRankPill}>
                      <Text style={styles.reviewRankText}>Rank #{task.rank}</Text>
                    </View>
                    <View style={[styles.priorityPill, task.priority === 'high' ? styles.pillHigh : styles.pillMed]}>
                      <Text style={styles.pillText}>{task.priority.toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={styles.reviewTaskTitle}>{task.title}</Text>
                  <Text style={styles.reviewTaskDetails}>
                    📅 {task.scheduled_date} ({task.scheduled_start_time || 'All Day'}) • {task.estimated_duration_hours}h load
                  </Text>
                  <Text style={styles.reviewTaskStress}>
                    Stress Impact: {task.stress_score}% • Category: {task.category}
                  </Text>
                  {task.ai_reasoning ? (
                    <Text style={styles.reviewTaskReasoning}>AI: {task.ai_reasoning}</Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 }}>
                    <Pressable onPress={() => handleRejectTask(task.id)} style={styles.rejectBtn}>
                      <Text style={styles.rejectBtnText}>Skip</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                onPress={handleApproveAllPending}
                disabled={approving}
                style={[styles.primaryModalBtn, approving && { opacity: 0.7 }]}
              >
                {approving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryModalBtnText}>Approve & Save Analysis</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── QUICK ADD NLP CHATBOT MODAL (2-Way Calendar Sync) ─────────────── */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>AI Quick Task Logger</Text>
                <Text style={styles.modalSubtitle}>
                  Type naturally (e.g. "2 assignment due Fri", "Exam Thu 2pm")
                </Text>
              </View>
              <Pressable onPress={() => setShowAddModal(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </Pressable>
            </View>

            <TextInput
              style={styles.chatInput}
              placeholder="e.g. 2 assignment due Fri, Gym tomorrow 6pm..."
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
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.nlpParseButtonText}>Analyze with AI</Text>
              )}
            </Pressable>

            {/* Structured Schema Preview */}
            {parsedPreview && (
              <View style={styles.previewBox}>
                <Text style={styles.previewHeader}>Auto-Detected Schema:</Text>
                <Text style={styles.previewTitle}>📌 {parsedPreview.title}</Text>
                <Text style={styles.previewDetail}>
                  Category: <Text style={{ fontWeight: '600' }}>{parsedPreview.category}</Text> • Priority: <Text style={{ fontWeight: '600' }}>{parsedPreview.priority.toUpperCase()}</Text>
                </Text>
                <Text style={styles.previewDetail}>
                  Date: {parsedPreview.scheduled_date} ({parsedPreview.scheduled_start_time || '09:00'}) • {parsedPreview.estimated_duration_hours}h
                </Text>
                <Text style={styles.previewDetail}>
                  Estimated Stress Impact: {parsedPreview.stress_score}%
                </Text>

                <Pressable
                  onPress={handleConfirmAddTask}
                  disabled={addingTask}
                  style={[styles.primaryModalBtn, { marginTop: 12 }, addingTask && { opacity: 0.7 }]}
                >
                  {addingTask ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryModalBtnText}>Approve & Sync to Calendar</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        </View>
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
  activeDayBadge: { backgroundColor: '#7C5730', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  activeDayText: { fontSize: 12, color: '#FFFFFF', fontWeight: '700' },
  insightBanner: { flexDirection: 'row', backgroundColor: '#FFF5F0', borderRadius: 12, padding: 12, marginTop: 4 },
  insightIconContainer: { marginRight: 8, marginTop: 2 },
  insightContent: { flex: 1 },
  insightTitle: { fontSize: 14, fontWeight: '700', color: '#E07A5F', marginBottom: 2 },
  insightText: { fontSize: 12, color: '#6B7280', lineHeight: 18 },
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
  taskCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FAF8F5', borderRadius: 12, padding: 10, marginBottom: 8 },
  taskRankBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EFEBE4', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  taskRankText: { fontSize: 12, fontWeight: '700', color: COLORS.text },
  taskBody: { flex: 1 },
  taskTitleText: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  taskTagsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  priorityPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, marginRight: 6 },
  pillHigh: { backgroundColor: '#FEE2E2' },
  pillMed: { backgroundColor: '#FEF3C7' },
  pillLow: { backgroundColor: '#DCFCE7' },
  pillText: { fontSize: 9, fontWeight: '700' },
  taskSubDetail: { fontSize: 11, color: '#6B7280' },
  deleteButton: { padding: 6 },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  modalSubtitle: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  reviewTaskItem: { backgroundColor: '#FAF8F5', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#EFEBE4' },
  reviewRankPill: { backgroundColor: '#EFEBE4', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  reviewRankText: { fontSize: 11, fontWeight: '700', color: COLORS.text },
  reviewTaskTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginTop: 6 },
  reviewTaskDetails: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  reviewTaskStress: { fontSize: 12, color: '#B45309', fontWeight: '600', marginTop: 2 },
  reviewTaskReasoning: { fontSize: 11, color: '#4B5563', fontStyle: 'italic', marginTop: 4 },
  rejectBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#F3F4F6' },
  rejectBtnText: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  modalActions: { marginTop: 14 },
  primaryModalBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryModalBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  chatInput: { backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, fontSize: 14, minHeight: 60, textAlignVertical: 'top', color: COLORS.text },
  nlpParseButton: { backgroundColor: '#7C5730', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  nlpParseButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  previewBox: { backgroundColor: '#F0FDF4', borderRadius: 12, padding: 12, marginTop: 14, borderWidth: 1, borderColor: '#BBF7D0' },
  previewHeader: { fontSize: 11, fontWeight: '700', color: '#166534', letterSpacing: 0.5, marginBottom: 4 },
  previewTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  previewDetail: { fontSize: 12, color: '#374151', marginTop: 2 },
});