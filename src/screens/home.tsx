import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';

import { colors } from '@/theme';
import TopNavigation from '@/components/topbar';
import BottomNavigation from '@/components/bottombar';

// Anchored to src/theme, which carries the Figma swatches. The few values
// below that aren't in the token set (warning washes, error) stay literal until
// they're needed on a second screen.
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
};

export default function Home() {
  const router = useRouter();
  const [deferredTasks, setDeferredTasks] = useState<string[]>([]);

  const deferTask = (task: string) => {
    setDeferredTasks((prev) =>
      prev.includes(task) ? prev : [...prev, task],
    );
  };

  const isDeferred = (task: string) => deferredTasks.includes(task);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={styles.container}>
        {/* Top Navigation Bar */}
        <TopNavigation
          onNotificationPress={() => {
            // Add notification screen handler here later
          }}
        />

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
                <Path
                  d="M 20 85 C 50 82, 60 70, 80 68 C 110 65, 120 22, 140 16 C 160 12, 180 50, 200 55 C 230 62, 240 75, 260 78 C 290 82, 300 92, 320 90 C 340 88, 355 85, 365 85 L 365 100 L 20 100 Z"
                  fill="url(#stressGradient)"
                />

                {/* Smooth Curve */}
                <Path
                  d="M 20 85 C 50 82, 60 70, 80 68 C 110 65, 120 22, 140 16 C 160 12, 180 50, 200 55 C 230 62, 240 75, 260 78 C 290 82, 300 92, 320 90 C 340 88, 355 85, 365 85"
                  stroke="#7c5730"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />

                {/* Peak Point on Wednesday */}
                <Circle cx="140" cy="16" r="6" fill="#ba1a1a" stroke="#ffffff" strokeWidth="2.5" />

                {/* Node Points */}
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
                <MaterialIcons name="notifications-active" size={18} color="#E07A5F" />
              </View>
              <View style={styles.insightContent}>
                <Text style={styles.insightTitle}>Early Warning Insight</Text>
                <Text style={styles.insightText}>
                  Wednesday load spiked severely. Ensure your schedule tomorrow supports active restoration blocks.
                </Text>
              </View>
            </View>
          </View>

          {/* 2. Weekly Capacity */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.sectionLabel}>WEEKLY CAPACITY</Text>
              <View style={styles.nearLimitBadge}>
                <Text style={styles.nearLimitText}>Near Limit</Text>
              </View>
            </View>

            <View style={styles.capacityContainer}>
              <View style={styles.capacityCircleWrapper}>
                <Svg height="144" width="144" viewBox="0 0 120 120" style={{ transform: [{ rotate: '-90deg' }] }}>
                  {/* Background Circle */}
                  <Circle cx="60" cy="60" r="48" fill="none" stroke="#F3F4F6" strokeWidth="12" />
                  {/* Academic 35% */}
                  <Circle cx="60" cy="60" r="48" fill="none" stroke="#F87171" strokeWidth="12" strokeDasharray="105.56 196.04" strokeDashoffset="0" />
                  {/* Social 20% */}
                  <Circle cx="60" cy="60" r="48" fill="none" stroke="#BAE6FD" strokeWidth="12" strokeDasharray="60.32 241.28" strokeDashoffset="-105.56" />
                  {/* Physical 15% */}
                  <Circle cx="60" cy="60" r="48" fill="none" stroke="#BBF7D0" strokeWidth="12" strokeDasharray="45.24 256.36" strokeDashoffset="-165.88" />
                  {/* Others 15% */}
                  <Circle cx="60" cy="60" r="48" fill="none" stroke="#FDE2E4" strokeWidth="12" strokeDasharray="45.24 256.36" strokeDashoffset="-211.12" />
                  {/* Mental 5% */}
                  <Circle cx="60" cy="60" r="48" fill="none" stroke="#E9D5FF" strokeWidth="12" strokeDasharray="15.08 286.52" strokeDashoffset="-256.36" />
                </Svg>
                <View style={styles.capacityOverlay}>
                  <View style={styles.capacityNumberRow}>
                    <Text style={styles.capacityNumber}>90</Text>
                    <Text style={styles.capacityPercent}>%</Text>
                  </View>
                  <Text style={styles.capacityLabel}>Capacity</Text>
                </View>
              </View>
            </View>

            {/* Capacity Overload Warning */}
            <View style={styles.capacityWarning}>
              <MaterialIcons name="warning" size={20} color="#CA8A04" style={{ marginRight: 10, marginTop: 2 }} />
              <View style={styles.warningContent}>
                <Text style={styles.warningTitle}>Overload Warning (90% capacity)</Text>
                <Text style={styles.warningText}>
                  You're nearing your weekly limit. Deferring 2 non-essential tasks will help avoid burnout.
                </Text>
              </View>
            </View>

            <View style={styles.capacitySection}>
              {/* Segmented Progress Bar */}
              <View style={styles.capacityBar}>
                <View style={[styles.capacitySegment, { width: '35%', backgroundColor: '#F87171' }]} />
                <View style={[styles.capacitySegment, { width: '20%', backgroundColor: '#BAE6FD' }]} />
                <View style={[styles.capacitySegment, { width: '15%', backgroundColor: '#BBF7D0' }]} />
                <View style={[styles.capacitySegment, { width: '15%', backgroundColor: '#FDE2E4' }]} />
                <View style={[styles.capacitySegment, { width: '5%', backgroundColor: '#E9D5FF' }]} />
              </View>

              {/* Category Percentages Legend */}
              <View style={styles.legendContainer}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#F87171' }]} />
                  <Text style={styles.legendText}>Academic (35%)</Text>
                </View>

                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#BAE6FD' }]} />
                  <Text style={styles.legendText}>Social (20%)</Text>
                </View>

                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#BBF7D0' }]} />
                  <Text style={styles.legendText}>Physical (15%)</Text>
                </View>

                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#FDE2E4' }]} />
                  <Text style={styles.legendText}>Others (15%)</Text>
                </View>

                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#E9D5FF' }]} />
                  <Text style={styles.legendText}>Mental (5%)</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 3. Categorized Load Map */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Categorized Load Map</Text>
              <Pressable onPress={() => {}} style={({ pressed }) => [pressed && styles.pressed]}>
                <Text style={styles.editText}>Edit ›</Text>
              </Pressable>
            </View>

            <View style={styles.categoryGrid}>
              <CategoryCard
                emoji="📚"
                title="Academic"
                description="Thesis & Lab prep"
                badge="4 Tasks"
                background="#FFEAEA"
                border="#FECDD3"
                badgeBackground="#FFE4E6"
                badgeColor="#E11D48"
              />
              <CategoryCard
                emoji="🌱"
                title="Social & Community"
                description="Coffee & birthdays"
                badge="2 Events"
                background="#E0F2FE"
                border="#BAE6FD"
                badgeBackground="#BAE6FD"
                badgeColor="#0284C7"
              />
              <CategoryCard
                emoji="🏃"
                title="Physical Health"
                description="Morning run & gym"
                badge="Active"
                background="#DCFCE7"
                border="#BBF7D0"
                badgeBackground="#BBF7D0"
                badgeColor="#16A34A"
              />
              <CategoryCard
                emoji="🧘"
                title="Mental/Downtime"
                description="Breathing, reading"
                badge="1 Session"
                background="#F3E8FF"
                border="#E9D5FF"
                badgeBackground="#E9D5FF"
                badgeColor="#9333EA"
              />

              {/* Full Width Category */}
              <View style={[styles.categoryFull, { backgroundColor: '#FDF2F4', borderColor: '#FBCFE8' }]}>
                <View style={styles.otherLeft}>
                  <Text style={styles.categoryEmoji}>🛒</Text>
                  <View style={{ marginLeft: 10 }}>
                    <Text style={styles.categoryTitle}>Others & Errands</Text>
                    <Text style={styles.categoryDescription}>Laundry, Groceries</Text>
                  </View>
                </View>
                <View style={styles.otherBadge}>
                  <Text style={styles.otherBadgeText}>3 Left</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 4. Load Balancer */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Load Balancer</Text>
              <View style={styles.spikeBadge}>
                <Text style={styles.spikeText}>SPIKE DETECTED</Text>
              </View>
            </View>

            <Text style={styles.loadDescription}>
              Academic is spiking. Defer these lower-priority tasks to balance your week:
            </Text>

            {!isDeferred('clean') && (
              <TaskRow
                emoji="🧹"
                title="Deep Clean Kitchen"
                subtitle="Errands • Medium priority"
                onDefer={() => deferTask('clean')}
              />
            )}

            {!isDeferred('desk') && (
              <TaskRow
                emoji="🗂️"
                title="Organize Desk Files"
                subtitle="Academic • Low priority"
                onDefer={() => deferTask('desk')}
              />
            )}

            {deferredTasks.length === 2 && (
              <View style={styles.allDeferred}>
                <Text style={styles.allDeferredText}>✓ Tasks deferred successfully</Text>
              </View>
            )}

            <Pressable
              onPress={() => {
                deferTask('clean');
                deferTask('desk');
              }}
              style={({ pressed }) => [
                styles.rebalanceButton,
                pressed && styles.pressedRebalance,
              ]}
            >
              <MaterialIcons name="settings" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.rebalanceText}>Apply Smart Rebalance</Text>
            </Pressable>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Bottom Navigation Bar */}
        <BottomNavigation activeTab="Home" router={router} />
      </View>
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
        <View style={styles.taskIcon}>
          <Text style={styles.taskEmoji}>{emoji}</Text>
        </View>
        <View style={styles.taskText}>
          <Text style={styles.taskTitle}>{title}</Text>
          <Text style={styles.taskSubtitle}>{subtitle}</Text>
        </View>
      </View>
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
  editText: { color: COLORS.primary, fontSize: 11, fontWeight: '600' },
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
  loadDescription: { color: '#4F453D', fontSize: 12, lineHeight: 18, marginBottom: 14 },
  spikeBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, backgroundColor: '#FEF3C7' },
  spikeText: { color: '#D97706', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  taskRow: { minHeight: 72, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  taskLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  taskIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FEF9C3', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  taskEmoji: { fontSize: 20 },
  taskText: { flex: 1 },
  taskTitle: { color: COLORS.textDark, fontSize: 12, fontWeight: '500' },
  taskSubtitle: { marginTop: 3, color: '#737373', fontSize: 10 },
  deferButton: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20, backgroundColor: '#FEF08A', flexDirection: 'row', alignItems: 'center' },
  deferText: { color: '#713F12', fontSize: 11, fontWeight: '700' },
  allDeferred: { padding: 12, marginBottom: 12, borderRadius: 14, backgroundColor: '#EFF6EB' },
  allDeferredText: { color: '#6A994E', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  rebalanceButton: { height: 48, borderRadius: 24, backgroundColor: COLORS.primaryContainer, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: '#6B5036', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  rebalanceText: { color: '#FFFFFF', fontSize: 14, fontWeight: '500' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  pressedRebalance: { opacity: 0.9, transform: [{ scale: 0.98 }] },
});