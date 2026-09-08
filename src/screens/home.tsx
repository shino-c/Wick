import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Screen } from "../components/base";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import BottomNavigation from '@/components/bottombar';
import TopNavigation from '@/components/topbar';
import type {
    WeeklyStressAnalysis,
    WorkloadAnalysis,
    WorkloadCategory,
  WorkloadItem,
  WorkloadPriority,
  WorkloadStatus,
} from '@/data/types';
import {
    addWorkloadItem,
    // completeWorkloadItem,
    // batchDeferWorkloadItems,
    // deferWorkloadItem,
    // getCalendarConnections,
    getWeeklyStressAnalysis,
    // listWorkloadItems,
    recomputeFusedScore,
    // syncCalendar,
} from '@/services/repository';
import { analyzeWorkload, getRankedTasks } from '@/services/workloadService';
import { colors } from '@/theme';
import { getMondayOfWeek, seedCalendarItems } from '@/data/localStore';

// Anchored to src/theme, which carries the Figma swatches.
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
  green: colors.calm,
};

const CATEGORIES: WorkloadCategory[] = [
  'academic',
  'social',
  'physical',
  'errands',
  'mental',
];

const CATEGORY_COLORS: Record<WorkloadCategory, string> = {
  academic: '#F87171',
  social: '#BAE6FD',
  physical: '#BBF7D0',
  errands: '#FDE2E4',
  mental: '#E9D5FF',
};

const CIRCUMFERENCE = 2 * Math.PI * 48; // ~301.59

const legacyPreviewAnalysis: WorkloadAnalysis = {
  totalCapacityPct: 90,
  weeklyHours: 36,
  capacityMaxHours: 40,
  spikingCategory: 'academic',
  isOverloaded: true,
  categoryBreakdown: {
    academic: {
      category: 'academic',
      name: 'Academic',
      emoji: '📚',
      hours: 13.5,
      percentage: 35,
      taskCount: 4,
      topDescription: 'Thesis & Lab prep',
      items: [],
    },
    social: {
      category: 'social',
      name: 'Social & Community',
      emoji: '🌱',
      hours: 7.5,
      percentage: 20,
      taskCount: 2,
      topDescription: 'Coffee & birthdays',
      items: [],
    },
    physical: {
      category: 'physical',
      name: 'Physical Health',
      emoji: '🏃',
      hours: 5.5,
      percentage: 15,
      taskCount: 2,
      topDescription: 'Morning run & gym',
      items: [],
    },
    errands: {
      category: 'errands',
      name: 'Others & Errands',
      emoji: '🛒',
      hours: 6.5,
      percentage: 15,
      taskCount: 3,
      topDescription: 'Laundry, Groceries',
      items: [],
    },
    mental: {
      category: 'mental',
      name: 'Mental/Downtime',
      emoji: '🧘',
      hours: 3.0,
      percentage: 5,
      taskCount: 2,
      topDescription: 'Breathing, reading',
      items: [],
    },
  },
  recommendedDeferrals: [],
};

const defaultAnalysis = analyzeWorkload([]);

export default function Home() {
  const router = useRouter();

  const [analysis, setAnalysis] = useState<WorkloadAnalysis>(defaultAnalysis);
  const [weeklyStress, setWeeklyStress] = useState<WeeklyStressAnalysis | null>(null);
  const [selectedStressIndex, setSelectedStressIndex] = useState<number | null>(null);
  const [rankedTasks, setRankedTasks] = useState<ReturnType<typeof getRankedTasks>>([]);
  const [mockWorkloadItems, setMockWorkloadItems] = useState<WorkloadItem[]>(() => seedCalendarItems('google'));
  const [deferredSuccessMsg, setDeferredSuccessMsg] = useState<string | null>(null);

  // Manual Task modal state
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualCategory, setManualCategory] = useState<WorkloadCategory>('academic');
  const [manualHours, setManualHours] = useState('1.5');
  const [manualPriority, setManualPriority] = useState<WorkloadPriority>('medium');
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualTime, setManualTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [savingTask, setSavingTask] = useState(false);

  // Demo mode intentionally ignores cached real calendar rows.
  const loadWorkload = useCallback(async () => {
    try {
      const items = mockWorkloadItems;
      // Real workload read (restore this when the demo should use the database):
      // const items = await listWorkloadItems();
      const weekStart = getMondayOfWeek();
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const currentWeekItems = items.filter((item) => {
        if (!item.scheduledStart) return false;
        const start = new Date(item.scheduledStart);
        return start >= weekStart && start < weekEnd;
      });
      const computed = analyzeWorkload(currentWeekItems);
      setAnalysis(computed);
      setRankedTasks(getRankedTasks(currentWeekItems));
      setWeeklyStress(await getWeeklyStressAnalysis(currentWeekItems));
      // Recompute stress fusion with this continuous load score
      await recomputeFusedScore(computed.totalCapacityPct);
    } catch (e) {
      console.warn('Failed to load workload analysis:', e);
    }
  }, [mockWorkloadItems]);

  useFocusEffect(
    useCallback(() => {
      loadWorkload();
      // Production calendar refresh, retained for restoring the live flow:
      // const refreshConnectedCalendar = async () => {
      //   const connections = await getCalendarConnections();
      //   await Promise.all(connections.filter((connection) => connection.connected).map(async (connection) => {
      //     try { await syncCalendar(connection.provider); } catch { /* permission/account may have changed */ }
      //   }));
      //   await loadWorkload();
      // };
      // const timer = setInterval(refreshConnectedCalendar, 60 * 1000);
      // return () => clearInterval(timer);
    }, [loadWorkload])
  );

  // Defer individual task
  const handleDefer = async (id: string) => {
    setMockWorkloadItems((items) => items.map((item) => item.id === id ? { ...item, status: 'deferred' } : item));
    // Real database mutation (restore with real workload reads):
    // await deferWorkloadItem(id);
    const updated = mockWorkloadItems.map((item) => item.id === id ? { ...item, status: 'deferred' as const } : item);
    const computed = analyzeWorkload(updated);
    setAnalysis(computed);
    setDeferredSuccessMsg('✓ Task deferred — workload capacity updated');
    await recomputeFusedScore(computed.totalCapacityPct);
  };

  const handleComplete = async (id: string) => {
    const target = mockWorkloadItems.find((item) => item.id === id);
    const nextStatus: WorkloadStatus = target?.status === 'completed' ? 'scheduled' : 'completed';
    setMockWorkloadItems((items) => items.map((item) => item.id === id ? { ...item, status: nextStatus } : item));
    // Real database mutation when real task data is enabled:
    // await completeWorkloadItem(id);
    const updated = mockWorkloadItems.map((item) => item.id === id ? { ...item, status: nextStatus } : item);
    const currentWeekItems = updated.filter((item) => item.scheduledStart && new Date(item.scheduledStart) >= getMondayOfWeek());
    const computed = analyzeWorkload(currentWeekItems);
    setAnalysis(computed);
    setRankedTasks(getRankedTasks(currentWeekItems));
    setWeeklyStress(await getWeeklyStressAnalysis(currentWeekItems));
    await recomputeFusedScore(computed.totalCapacityPct);
  };

  // Smart Rebalance: defer all flagged candidates in one tap
  const handleSmartRebalance = async () => {
    const ids = analysis.recommendedDeferrals.map((r) => r.id);
    if (ids.length > 0) {
      setMockWorkloadItems((items) => items.map((item) => ids.includes(item.id) ? { ...item, status: 'deferred' } : item));
      // Real database mutation (restore with real workload reads):
      // await batchDeferWorkloadItems(ids);
      const updated = mockWorkloadItems.map((item) => ids.includes(item.id) ? { ...item, status: 'deferred' as const } : item);
      const computed = analyzeWorkload(updated);
      setAnalysis(computed);
      setDeferredSuccessMsg(
        `✓ Smart Rebalance applied: capacity reduced to ${computed.totalCapacityPct}%`
      );
      await recomputeFusedScore(computed.totalCapacityPct);
    }
  };

  // Add manual task/errand
  const handleSaveTask = async () => {
    if (!manualTitle.trim()) return;
    setSavingTask(true);
    try {
      const hours = parseFloat(manualHours) || 1.0;
      const newTask = await addWorkloadItem({
        title: manualTitle.trim(),
        category: manualCategory,
        estimatedHours: hours,
        priority: manualPriority,
        source: 'manual',
        scheduledStart: new Date(`${manualDate}T${manualTime}:00`).toISOString(),
        scheduledEnd: new Date(new Date(`${manualDate}T${manualTime}:00`).getTime() + hours * 60 * 60 * 1000).toISOString(),
      });
      setMockWorkloadItems((items) => [newTask, ...items]);
      setManualTitle('');
      setManualHours('1.5');
      setManualDate(new Date().toISOString().slice(0, 10));
      setManualTime(new Date().toTimeString().slice(0, 5));
      setTaskModalVisible(false);
      await loadWorkload();
    } catch (e) {
      console.warn('Failed to add manual task:', e);
    } finally {
      setSavingTask(false);
    }
  };

  // Compute dynamic SVG donut arcs based on actual percentages
  const donutArcs = useMemo(() => {
    return CATEGORIES.reduce<{ category: WorkloadCategory; color: string; strokeDasharray: string; strokeDashoffset: number; percentage: number }[]>((arcs, cat) => {
      const summary = analysis.categoryBreakdown[cat];
      const pct = summary ? summary.percentage : 0;
      const arcLength = (pct / 100) * CIRCUMFERENCE;
      const cumulativeOffset = arcs.reduce((sum, arc) => sum + (arc.percentage / 100) * CIRCUMFERENCE, 0);
      arcs.push({
        category: cat,
        color: CATEGORY_COLORS[cat],
        strokeDasharray: `${arcLength} ${CIRCUMFERENCE - arcLength}`,
        strokeDashoffset: -cumulativeOffset,
        percentage: pct,
      });
      return arcs;
    }, []);
  }, [analysis]);

  const stressChart = useMemo(() => {
    const points = weeklyStress?.points ?? [];
    if (points.length === 0) return { line: '', area: '', coordinates: [] as { x: number; y: number }[] };
    const coordinates = points.map((point, index) => ({
      x: 20 + (index * 345) / Math.max(1, points.length - 1),
      y: 100 - (Math.min(100, Math.max(0, point.stressScore)) * 0.8),
    }));
    const line = coordinates.map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    return { line, area: `${line} L 365 100 L 20 100 Z`, coordinates };
  }, [weeklyStress]);

  return (
    <Screen
        scroll={false}
      padded={false}

        header={<TopNavigation />}
        footer={<BottomNavigation activeTab="Home" router={router} />}
      >
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

        <View style={styles.container}>

        {/* Main Scroll Content */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
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

                {/* Grid Lines */}
                <Line x1="10" y1="20" x2="370" y2="20" stroke="#f2eede" strokeWidth="1" strokeDasharray="4 4" />
                <Line x1="10" y1="60" x2="370" y2="60" stroke="#f2eede" strokeWidth="1" strokeDasharray="4 4" />
                <Line x1="10" y1="100" x2="370" y2="100" stroke="#f2eede" strokeWidth="1" />

                {/* Gradient Fill */}
                {stressChart.area && <Path d={stressChart.area} fill="url(#stressGradient)" />}

                {/* Smooth Curve */}
                {stressChart.line && <Path
                  d={stressChart.line}
                  stroke="#7c5730"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />}
                {weeklyStress?.points.map((point, index) => {
                  const coordinate = stressChart.coordinates?.[index];
                  return coordinate ? <Circle key={point.fullDate} cx={coordinate.x} cy={coordinate.y} r={selectedStressIndex === index || point.isPeak ? 6 : 3} fill={point.isPeak ? '#ba1a1a' : '#81756c'} stroke={selectedStressIndex === index || point.isPeak ? '#ffffff' : undefined} strokeWidth={selectedStressIndex === index || point.isPeak ? 2.5 : undefined} onPress={() => setSelectedStressIndex(index)} accessibilityLabel={`${point.dayLabel}: ${Math.round(point.stressScore)} percent stress`} /> : null;
                })}
              </Svg>

              {selectedStressIndex !== null && weeklyStress?.points[selectedStressIndex] && (
                <View style={styles.chartValueBubble}>
                  <Text style={styles.chartValueText}>
                    {weeklyStress.points[selectedStressIndex].dayLabel}: {Math.round(weeklyStress.points[selectedStressIndex].stressScore)}% stress
                  </Text>
                </View>
              )}

              <View style={styles.daysRow}>
                {(weeklyStress?.points ?? []).map((point) => point.isToday ? <View key={point.fullDate} style={styles.activeDayBadge}><Text style={styles.activeDayText}>{point.dayLabel}</Text></View> : <Text key={point.fullDate} style={styles.dayText}>{point.dayLabel}</Text>)}
              </View>
            </View>

            {/* Early Warning Banner */}
            <View style={styles.insightBanner}>
              <View style={styles.insightIconContainer}>
                <MaterialIcons name="notifications-active" size={18} color="#E07A5F" />
              </View>
              <View style={styles.insightContent}>
                <Text style={styles.insightTitle}>Early Warning Insight</Text>
                <Text style={styles.insightText}>
                  {weeklyStress?.insight ?? 'Add a calendar or task to start your stress forecast.'}
                </Text>
              </View>
            </View>
          </View>

          {/* 2. Weekly Capacity */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.sectionLabel}>WEEKLY CAPACITY</Text>
              <View
                style={[
                  styles.nearLimitBadge,
                  !analysis.isOverloaded && { backgroundColor: '#DCFCE7' },
                ]}
              >
                <Text
                  style={[
                    styles.nearLimitText,
                    !analysis.isOverloaded && { color: '#16A34A' },
                  ]}
                >
                  {analysis.isOverloaded ? 'Near Limit' : 'Balanced'}
                </Text>
              </View>
            </View>

            <View style={styles.capacityContainer}>
              <View style={styles.capacityCircleWrapper}>
                <Svg height="144" width="144" viewBox="0 0 120 120" style={{ transform: [{ rotate: '-90deg' }] }}>
                  {/* Background Track */}
                  <Circle cx="60" cy="60" r="48" fill="none" stroke="#F3F4F6" strokeWidth="12" />
                  {/* Dynamic Category Arcs */}
                  {donutArcs.map((arc) =>
                    arc.percentage > 0 ? (
                      <Circle
                        key={arc.category}
                        cx="60"
                        cy="60"
                        r="48"
                        fill="none"
                        stroke={arc.color}
                        strokeWidth="12"
                        strokeDasharray={arc.strokeDasharray}
                        strokeDashoffset={arc.strokeDashoffset}
                      />
                    ) : null
                  )}
                </Svg>
                <View style={styles.capacityOverlay}>
                  <View style={styles.capacityNumberRow}>
                    <Text style={styles.capacityNumber}>{analysis.totalCapacityPct}</Text>
                    <Text style={styles.capacityPercent}>%</Text>
                  </View>
                  <Text style={styles.capacityLabel}>Capacity</Text>
                </View>
              </View>
            </View>

            {/* Capacity Overload Warning or Balance Status */}
            {analysis.isOverloaded ? (
              <View style={styles.capacityWarning}>
                <MaterialIcons name="warning" size={20} color="#CA8A04" style={{ marginRight: 10, marginTop: 2 }} />
                <View style={styles.warningContent}>
                  <Text style={styles.warningTitle}>Overload Warning ({analysis.totalCapacityPct}% capacity)</Text>
                  <Text style={styles.warningText}>
                    You&apos;re nearing your weekly limit ({analysis.weeklyHours}h scheduled). Deferring{' '}
                    {analysis.recommendedDeferrals.length > 0 ? analysis.recommendedDeferrals.length : 2}{' '}
                    non-essential tasks will help avoid burnout.
                  </Text>
                </View>
              </View>
            ) : (
              <View style={[styles.capacityWarning, { backgroundColor: '#EFF6EB', borderColor: '#BBF7D0' }]}>
                <MaterialIcons name="check-circle" size={20} color="#16A34A" style={{ marginRight: 10, marginTop: 2 }} />
                <View style={styles.warningContent}>
                  <Text style={[styles.warningTitle, { color: '#166534' }]}>Schedule Balanced ({analysis.totalCapacityPct}% capacity)</Text>
                  <Text style={[styles.warningText, { color: '#15803D' }]}>
                    Your scheduled load ({analysis.weeklyHours}h) is within sustainable limits. Good space for rest!
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.capacitySection}>
              {/* Dynamic Segmented Progress Bar */}
              <View style={styles.capacityBar}>
                {CATEGORIES.map((cat) => {
                  const pct = analysis.categoryBreakdown[cat]?.percentage ?? 0;
                  if (pct === 0) return null;
                  return (
                    <View
                      key={cat}
                      style={[
                        styles.capacitySegment,
                        { width: `${pct}%`, backgroundColor: CATEGORY_COLORS[cat] },
                      ]}
                    />
                  );
                })}
              </View>

              {/* Category Percentages Legend */}
              <View style={styles.legendContainer}>
                {CATEGORIES.map((cat) => {
                  const item = analysis.categoryBreakdown[cat];
                  return (
                    <View key={cat} style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: CATEGORY_COLORS[cat] }]} />
                      <Text style={styles.legendText}>
                        {item.name} ({item.percentage}%)
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          {/* 3. Categorized Load Map */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Categorized Load Map</Text>
              <Pressable
                onPress={() => setTaskModalVisible(true)}
                style={({ pressed }) => [pressed && styles.pressed]}
              >
                <Text style={styles.editText}>+ Add Task ›</Text>
              </Pressable>
            </View>

            <View style={styles.categoryGrid}>
              <CategoryCard
                emoji="📚"
                title="Academic"
                description={analysis.categoryBreakdown.academic.topDescription}
                badge={`${analysis.categoryBreakdown.academic.taskCount} Tasks`}
                background="#FFEAEA"
                border="#FECDD3"
                badgeBackground="#FFE4E6"
                badgeColor="#E11D48"
              />
              <CategoryCard
                emoji="🌱"
                title="Social & Community"
                description={analysis.categoryBreakdown.social.topDescription}
                badge={`${analysis.categoryBreakdown.social.taskCount} Events`}
                background="#E0F2FE"
                border="#BAE6FD"
                badgeBackground="#BAE6FD"
                badgeColor="#0284C7"
              />
              <CategoryCard
                emoji="🏃"
                title="Physical Health"
                description={analysis.categoryBreakdown.physical.topDescription}
                badge={analysis.categoryBreakdown.physical.taskCount > 0 ? 'Active' : 'Rest'}
                background="#DCFCE7"
                border="#BBF7D0"
                badgeBackground="#BBF7D0"
                badgeColor="#16A34A"
              />
              <CategoryCard
                emoji="🧘"
                title="Mental/Downtime"
                description={analysis.categoryBreakdown.mental.topDescription}
                badge={`${analysis.categoryBreakdown.mental.taskCount} Session${analysis.categoryBreakdown.mental.taskCount === 1 ? '' : 's'}`}
                background="#F3E8FF"
                border="#E9D5FF"
                badgeBackground="#E9D5FF"
                badgeColor="#9333EA"
              />

              {/* Full Width Category: Errands */}
              <View style={[styles.categoryFull, { backgroundColor: '#FDF2F4', borderColor: '#FBCFE8' }]}>
                <View style={styles.otherLeft}>
                  <Text style={styles.categoryEmoji}>🛒</Text>
                  <View style={{ marginLeft: 10 }}>
                    <Text style={styles.categoryTitle}>Others & Errands</Text>
                    <Text style={styles.categoryDescription}>
                      {analysis.categoryBreakdown.errands.topDescription}
                    </Text>
                  </View>
                </View>
                <View style={styles.otherBadge}>
                  <Text style={styles.otherBadgeText}>
                    {analysis.categoryBreakdown.errands.taskCount} Left
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* 4. Ranked tasks: priority first, then time. */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>This Week Tasks</Text>
              <Pressable onPress={() => setTaskModalVisible(true)}><Text style={styles.editText}>+ Add Task ›</Text></Pressable>
            </View>
            {rankedTasks.length === 0 ? (
              <Text style={styles.loadDescription}>No tasks yet. Add one manually, or sync a device calendar to build your live load map.</Text>
            ) : rankedTasks.map((task) => (
                <Pressable key={task.id} onPress={() => handleComplete(task.id)} style={({ pressed }) => [styles.rankedTaskRow, pressed && styles.pressed]}>
                <Text style={styles.rankNumber}>#{task.rank}</Text>
                <View style={{ flex: 1 }}><Text style={[styles.rankedTaskTitle, task.status === 'completed' && styles.completedTaskText]}>{task.title}</Text><Text style={[styles.rankedTaskMeta, task.status === 'completed' && styles.completedTaskText]}>{task.timeFormatted}</Text></View>
                <Text style={[styles.priorityPill, task.priority === 'low' ? styles.priorityLow : task.priority === 'medium' ? styles.priorityMedium : styles.priorityHigh]}>{task.priority}</Text>
                </Pressable>
            ))}
          </View>

          {/* 4. Load Balancer */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Load Balancer</Text>
              <View
                style={[
                  styles.spikeBadge,
                  !analysis.spikingCategory && { backgroundColor: '#DCFCE7' },
                ]}
              >
                <Text
                  style={[
                    styles.spikeText,
                    !analysis.spikingCategory && { color: '#16A34A' },
                  ]}
                >
                  {analysis.spikingCategory ? 'SPIKE DETECTED' : 'STABLE'}
                </Text>
              </View>
            </View>

            <Text style={styles.loadDescription}>
              {analysis.spikingCategory
                ? `${analysis.categoryBreakdown[analysis.spikingCategory]?.name} is spiking. Defer these lower-priority tasks to balance your week:`
                : analysis.totalCapacityPct >= 80
                ? 'Your schedule is near capacity. Defer lower-priority tasks to recover headroom:'
                : `Your schedule is well balanced at ${analysis.totalCapacityPct}% capacity. No urgent deferrals needed.`}
            </Text>

            {analysis.recommendedDeferrals.map((task) => (
              <TaskRow
                key={task.id}
                emoji={
                  task.category === 'errands'
                    ? '🧹'
                    : task.category === 'academic'
                    ? '🗂️'
                    : '📋'
                }
                title={task.title}
                subtitle={`${task.category.charAt(0).toUpperCase() + task.category.slice(1)} • ${task.priority} priority • ${task.estimatedHours}h`}
                status={task.status}
                onDefer={() => handleDefer(task.id)}
                onComplete={() => handleComplete(task.id)}
              />
            ))}

            {deferredSuccessMsg && (
              <View style={styles.allDeferred}>
                <Text style={styles.allDeferredText}>{deferredSuccessMsg}</Text>
              </View>
            )}

            {analysis.recommendedDeferrals.length > 0 && (
              <Pressable
                onPress={handleSmartRebalance}
                style={({ pressed }) => [
                  styles.rebalanceButton,
                  pressed && styles.pressedRebalance,
                ]}
              >
                <MaterialIcons name="settings" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.rebalanceText}>Apply Smart Rebalance</Text>
              </Pressable>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
        </View>

        {/* Manual Task / Errand Entry Modal */}
        <Modal
          visible={taskModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setTaskModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Task or Errand</Text>
                <Pressable
                  onPress={() => setTaskModalVisible(false)}
                  style={({ pressed }) => [styles.modalClose, pressed && styles.pressed]}
                >
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {/* Task Title */}
              <Text style={styles.inputLabel}>TITLE</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Deep Clean Kitchen, Thesis Writing"
                placeholderTextColor="#9A968C"
                value={manualTitle}
                onChangeText={setManualTitle}
              />

              {/* Category selector */}
              <Text style={styles.inputLabel}>CATEGORY</Text>
              <View style={styles.categoryChips}>
                {CATEGORIES.map((cat) => (
                  <Pressable
                    key={cat}
                    onPress={() => setManualCategory(cat)}
                    style={[
                      styles.categoryChip,
                      manualCategory === cat && styles.categoryChipSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        manualCategory === cat && styles.categoryChipTextSelected,
                      ]}
                    >
                      {cat === 'academic' && '📚 Academic'}
                      {cat === 'social' && '🌱 Social'}
                      {cat === 'physical' && '🏃 Physical'}
                      {cat === 'errands' && '🛒 Errands'}
                      {cat === 'mental' && '🧘 Mental'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Duration / Hours & Priority */}
              <View style={styles.rowTwoCols}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>ESTIMATED HOURS</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="1.5"
                    placeholderTextColor="#9A968C"
                    keyboardType="decimal-pad"
                    value={manualHours}
                    onChangeText={setManualHours}
                  />
                </View>

                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.inputLabel}>PRIORITY</Text>
                  <View style={styles.priorityGroup}>
                    {(['low', 'medium', 'high'] as WorkloadPriority[]).map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => setManualPriority(p)}
                        style={[
                          styles.priorityButton,
                          manualPriority === p && styles.priorityButtonSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.priorityText,
                            manualPriority === p && styles.priorityTextSelected,
                          ]}
                        >
                          {p.toUpperCase()}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>

              <View style={styles.scheduleFields}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>DAY</Text>
                  <TextInput style={styles.textInput} placeholder="YYYY-MM-DD" placeholderTextColor="#9A968C" value={manualDate} onChangeText={setManualDate} />
                </View>
                <View style={{ width: 110, marginLeft: 12 }}>
                  <Text style={styles.inputLabel}>TIME</Text>
                  <TextInput style={styles.textInput} placeholder="09:00" placeholderTextColor="#9A968C" value={manualTime} onChangeText={setManualTime} />
                </View>
              </View>

              {/* Submit Button */}
              <Pressable
                disabled={savingTask || !manualTitle.trim()}
                onPress={handleSaveTask}
                style={({ pressed }) => [
                  styles.saveTaskButton,
                  (!manualTitle.trim() || savingTask) && styles.disabledButton,
                  pressed && styles.pressedRebalance,
                ]}
              >
                {savingTask ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveTaskButtonText}>Save to Workload</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Modal>
      </Screen>
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
  status,
  onDefer,
  onComplete,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  status: WorkloadItem['status'];
  onDefer: () => void;
  onComplete: () => void;
}) {
  return (
    <View style={styles.taskRow}>
      <Pressable onPress={onComplete} style={({ pressed }) => [styles.taskLeft, pressed && styles.pressed]}>
        <View style={styles.taskIcon}>
          <Text style={styles.taskEmoji}>{emoji}</Text>
        </View>
        <View style={styles.taskText}>
          <Text style={[styles.taskTitle, status === 'completed' && styles.completedTaskText]}>{title}</Text>
          <Text style={[styles.taskSubtitle, status === 'completed' && styles.completedTaskText]}>{subtitle}</Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onDefer}
        style={({ pressed }) => [styles.deferButton, pressed && styles.pressed]}
      >
        <Text style={styles.deferText}>Defer</Text>
        <MaterialIcons name="schedule" size={14} color="#713F12" style={{ marginLeft: 4 }} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#6B5036',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  cardTitle: { flex: 1, color: COLORS.primary, fontSize: 18, lineHeight: 24, fontWeight: '500' },
  adaptiveBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: '#FFF3BA' },
  adaptiveText: { color: COLORS.primaryContainer, fontSize: 11, fontWeight: '500' },
  chartContainer: { height: 160, marginTop: 4, marginBottom: 12 },
  chartValueBubble: { alignSelf: 'center', marginTop: -2, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: '#FFF3BA' },
  chartValueText: { color: COLORS.primary, fontSize: 11, fontWeight: '700' },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8, marginTop: 8 },
  dayText: { width: 24, textAlign: 'center', color: COLORS.outline, fontSize: 11, fontWeight: '500' },
  activeDayBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255, 218, 214, 0.5)', alignItems: 'center', justifyContent: 'center' },
  activeDayText: { color: COLORS.error, fontSize: 11, fontWeight: '700' },
  insightBanner: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderRadius: 16, backgroundColor: '#FDF0ED', borderWidth: 1, borderColor: 'rgba(224,122,95,0.25)' },
  insightIconContainer: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(224,122,95,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  insightContent: { flex: 1 },
  insightTitle: { color: '#E07A5F', fontSize: 12, fontWeight: '500' },
  insightText: { marginTop: 2, color: COLORS.text, fontSize: 12, lineHeight: 17 },
  sectionLabel: { color: '#737373', fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
  nearLimitBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, backgroundColor: '#FFEAEA' },
  nearLimitText: { color: '#D93B4F', fontSize: 12, fontWeight: '600' },
  capacityContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  capacityCircleWrapper: { width: 144, height: 144, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  capacityOverlay: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  capacityNumberRow: { flexDirection: 'row', alignItems: 'baseline' },
  capacityNumber: { color: COLORS.textDark, fontSize: 30, fontWeight: '700' },
  capacityPercent: { color: COLORS.textDark, fontSize: 16, fontWeight: '600' },
  capacityLabel: { marginTop: 2, color: '#737373', fontSize: 12, fontWeight: '500' },
  capacityWarning: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderRadius: 12, backgroundColor: COLORS.warning, borderWidth: 1, borderColor: COLORS.warningBorder, marginTop: 12 },
  warningContent: { flex: 1 },
  warningTitle: { color: COLORS.warningText, fontSize: 12, fontWeight: '700' },
  warningText: { marginTop: 2, color: COLORS.warningSubtext, fontSize: 12, lineHeight: 17 },
  capacitySection: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EAE5DB' },
  capacityBar: { height: 10, borderRadius: 6, overflow: 'hidden', backgroundColor: '#F3F4F6', flexDirection: 'row' },
  capacitySegment: { height: '100%' },
  legendContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 12, gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendText: { fontSize: 12, fontWeight: '500', color: '#4B5563' },
  editText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  categoryCard: { width: '48.5%', minHeight: 145, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10, justifyContent: 'space-between' },
  categoryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  categoryEmoji: { fontSize: 21 },
  categoryBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  categoryBadgeText: { fontSize: 10, fontWeight: '700' },
  categoryBottom: { marginTop: 12 },
  categoryTitle: { color: COLORS.textDark, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  categoryDescription: { marginTop: 2, color: '#737373', fontSize: 11, lineHeight: 16 },
  categoryFull: { width: '100%', minHeight: 72, borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  otherLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  otherBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 13, backgroundColor: '#FFE4E6' },
  otherBadgeText: { color: '#E11D48', fontSize: 10, fontWeight: '700' },
  loadDescription: { color: '#4F453D', fontSize: 13, lineHeight: 19, marginBottom: 14 },
  spikeBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, backgroundColor: '#FEF3C7' },
  spikeText: { color: '#D97706', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  taskRow: { minHeight: 72, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  taskLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  taskIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FEF9C3', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  taskEmoji: { fontSize: 20 },
  taskText: { flex: 1 },
  taskTitle: { color: COLORS.textDark, fontSize: 13, fontWeight: '600' },
  taskSubtitle: { marginTop: 3, color: '#737373', fontSize: 11 },
  deferButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FEF08A', flexDirection: 'row', alignItems: 'center' },
  deferText: { color: '#713F12', fontSize: 12, fontWeight: '700' },
  allDeferred: { padding: 12, marginBottom: 12, borderRadius: 14, backgroundColor: '#EFF6EB' },
  allDeferredText: { color: '#6A994E', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  rebalanceButton: { height: 48, borderRadius: 24, backgroundColor: COLORS.primaryContainer, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: '#6B5036', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  rebalanceText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 36 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  modalClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F5F2EC', alignItems: 'center', justifyContent: 'center' },
  modalCloseText: { color: COLORS.outline, fontSize: 15, fontWeight: '700' },
  inputLabel: { color: COLORS.outline, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6, marginTop: 12 },
  textInput: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#EDE7D6', paddingHorizontal: 14, color: COLORS.text, fontSize: 15, backgroundColor: '#FAFAF8' },
  categoryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: '#F5F2EC', borderWidth: 1, borderColor: '#EAE5DB' },
  categoryChipSelected: { backgroundColor: '#FDF1A9', borderColor: '#ECCB49' },
  categoryChipText: { color: '#6E6A61', fontSize: 12, fontWeight: '600' },
  categoryChipTextSelected: { color: '#3D2E1E', fontWeight: '700' },
  rowTwoCols: { flexDirection: 'row', alignItems: 'center' },
  scheduleFields: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 2 },
  priorityGroup: { flexDirection: 'row', height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#EDE7D6', overflow: 'hidden' },
  priorityButton: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAF8' },
  priorityButtonSelected: { backgroundColor: COLORS.primary },
  priorityText: { color: COLORS.outline, fontSize: 11, fontWeight: '700' },
  priorityTextSelected: { color: '#FFFFFF', fontWeight: '800' },
  saveTaskButton: { height: 50, borderRadius: 25, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  saveTaskButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  disabledButton: { opacity: 0.5 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  rankedTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F2EEE8' },
  rankNumber: { color: COLORS.outline, fontWeight: '700', width: 28 },
  rankedTaskTitle: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
  rankedTaskMeta: { color: COLORS.outline, fontSize: 12, marginTop: 2 },
  completedTaskText: { textDecorationLine: 'line-through', opacity: 0.55 },
  priorityPill: { overflow: 'hidden', color: '#8A5A16', backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  priorityLow: { backgroundColor: '#DCFCE7', color: '#15803D' },
  priorityMedium: { backgroundColor: '#FEF3C7', color: '#A16207' },
  priorityHigh: { backgroundColor: '#FEE2E2', color: '#B91C1C' },
  pressedRebalance: { opacity: 0.9, transform: [{ scale: 0.98 }] },
});
