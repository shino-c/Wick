/**
 * workloadService.ts — Pillar 1: Passive Load Engine & Load Balancer.
 *
 * Provides:
 * 1. Calendar sync for Google Calendar & Outlook + manual task/errand entry.
 * 2. Categorized load mapping across 5 distinct domains:
 *    - Academic
 *    - Social
 *    - Physical
 *    - Errands
 *    - Mental / Downtime
 * 3. Workload capacity calculation: total capacity % against baseline (e.g. 90%).
 * 4. Load balancer: detects category spikes and identifies lower-priority tasks
 *    for deferral.
 * 5. Supabase persistence with seamless fallback to on-device localStore.
 */

import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

import { readDb, uid, writeDb, getLocalDateKey, getMondayOfWeek } from '@/data/localStore';
import type {
  CalendarConnection,
  CategoryLoadSummary,
  WorkloadAnalysis,
  WorkloadCategory,
  WorkloadItem,
  WorkloadPriority,
  RankedTask,
} from '@/data/types';
import { currentUserId, hasSupabase, supabase } from '@/lib/supabaseClient';

export const WEEKLY_CAPACITY_MAX_HOURS = 40;

const CATEGORY_META: Record<
  WorkloadCategory,
  { name: string; emoji: string; defaultDesc: string }
> = {
  academic: {
    name: 'Academic',
    emoji: '📚',
    defaultDesc: 'Lectures, labs & study',
  },
  social: {
    name: 'Social & Community',
    emoji: '🌱',
    defaultDesc: 'Coffee, dinners & meetups',
  },
  physical: {
    name: 'Physical Health',
    emoji: '🏃',
    defaultDesc: 'Workouts, runs & sports',
  },
  errands: {
    name: 'Others & Errands',
    emoji: '🛒',
    defaultDesc: 'Groceries, laundry & chores',
  },
  mental: {
    name: 'Mental/Downtime',
    emoji: '🧘',
    defaultDesc: 'Breathing, reading & rest',
  },
};

/**
 * Derives a full WorkloadAnalysis from an array of workload items.
 */
export function analyzeWorkload(
  items: WorkloadItem[],
  maxHours: number = WEEKLY_CAPACITY_MAX_HOURS
): WorkloadAnalysis {
  const scheduled = items.filter((item) => item.status === 'scheduled');

  const categories: WorkloadCategory[] = [
    'academic',
    'social',
    'physical',
    'errands',
    'mental',
  ];

  const categoryMap: Partial<Record<WorkloadCategory, CategoryLoadSummary>> = {};

  let totalScheduledHours = 0;

  // First pass: compute hours and gather items per category
  for (const cat of categories) {
    const catItems = scheduled.filter((i) => i.category === cat);
    const hours = Math.round(catItems.reduce((acc, i) => acc + i.estimatedHours, 0) * 10) / 10;
    totalScheduledHours += hours;

    const titles = catItems.map((i) => i.title);
    const topDescription =
      titles.length > 0
        ? titles.slice(0, 2).join(' & ')
        : CATEGORY_META[cat].defaultDesc;

    categoryMap[cat] = {
      category: cat,
      name: CATEGORY_META[cat].name,
      emoji: CATEGORY_META[cat].emoji,
      hours,
      percentage: 0,
      taskCount: catItems.length,
      topDescription,
      items: catItems,
    };
  }

  totalScheduledHours = Math.round(totalScheduledHours * 10) / 10;

  // Second pass: compute percentage shares
  for (const cat of categories) {
    const summary = categoryMap[cat]!;
    summary.percentage =
      totalScheduledHours > 0
        ? Math.round((summary.hours / totalScheduledHours) * 100)
        : 0;
  }

  // Capacity calculation against the weekly max hours
  const totalCapacityPct =
    maxHours > 0
      ? Math.min(100, Math.round((totalScheduledHours / maxHours) * 100))
      : 0;

  // Detect spike: whichever category exceeds 30% of total load or has >= 10 hours
  let spikingCategory: WorkloadCategory | null = null;
  let maxCatHours = 0;
  for (const cat of categories) {
    const catHours = categoryMap[cat]!.hours;
    if (catHours > maxCatHours && (catHours >= 10 || categoryMap[cat]!.percentage >= 30)) {
      maxCatHours = catHours;
      spikingCategory = cat;
    }
  }

  // Find lower-priority candidates for deferral
  const recommendedDeferrals: WorkloadItem[] = [];

  // 1. Lower-priority items from the spiking category (e.g. low-priority academic tasks)
  if (spikingCategory) {
    const spikeItems = categoryMap[spikingCategory]!.items.filter(
      (i) => i.priority === 'low' || i.priority === 'medium'
    );
    // Sort low priority first
    spikeItems.sort((a, b) => (a.priority === 'low' ? -1 : 1));
    if (spikeItems.length > 0) {
      recommendedDeferrals.push(spikeItems[0]);
    }
  }

  // 2. Non-essential errands (medium/low priority)
  const errandCandidates = categoryMap['errands']!.items.filter(
    (i) =>
      (i.priority === 'low' || i.priority === 'medium') &&
      !recommendedDeferrals.some((r) => r.id === i.id)
  );
  if (errandCandidates.length > 0) {
    recommendedDeferrals.push(errandCandidates[0]);
  }

  // 3. Fallback: if we still need more candidates and capacity is high (>80%)
  if (totalCapacityPct >= 80 && recommendedDeferrals.length < 2) {
    const remainingCandidates = scheduled.filter(
      (i) =>
        i.priority !== 'high' &&
        i.category !== 'mental' &&
        !recommendedDeferrals.some((r) => r.id === i.id)
    );
    if (remainingCandidates.length > 0) {
      recommendedDeferrals.push(remainingCandidates[0]);
    }
  }

  return {
    totalCapacityPct,
    weeklyHours: totalScheduledHours,
    capacityMaxHours: maxHours,
    categoryBreakdown: categoryMap as Record<WorkloadCategory, CategoryLoadSummary>,
    spikingCategory,
    isOverloaded: totalCapacityPct >= 80,
    recommendedDeferrals,
  };
}

/* ── Supabase & Local Database Integration ────────────────────────── */

export async function listWorkloadItems(): Promise<WorkloadItem[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('workload_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (data && data.length > 0) {
      return data.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category as WorkloadCategory,
        estimatedHours: r.estimated_hours,
        priority: r.priority,
        source: r.source,
        status: r.status,
        scheduledStart: r.scheduled_start,
        scheduledEnd: r.scheduled_end,
        createdAt: r.created_at,
      }));
    }
  }

  const db = await readDb();
  return db.workloadItems ?? [];
}

export async function addWorkloadItem(
  item: Omit<WorkloadItem, 'id' | 'createdAt' | 'status'> & { status?: WorkloadItem['status'] }
): Promise<WorkloadItem> {
  const newItem: WorkloadItem = {
    id: uid(),
    title: item.title,
    category: item.category,
    estimatedHours: item.estimatedHours,
    priority: item.priority,
    source: item.source,
    status: item.status ?? 'scheduled',
    scheduledStart: item.scheduledStart ?? null,
    scheduledEnd: item.scheduledEnd ?? null,
    createdAt: new Date().toISOString(),
  };

  if (hasSupabase) {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('workload_items')
      .insert({
        id: newItem.id,
        user_id: userId,
        title: newItem.title,
        category: newItem.category,
        estimated_hours: newItem.estimatedHours,
        priority: newItem.priority,
        source: newItem.source,
        status: newItem.status,
        scheduled_start: newItem.scheduledStart,
        scheduled_end: newItem.scheduledEnd,
      })
      .select()
      .single();

    if (!error && data) {
      newItem.id = data.id;
    }
  }

  await writeDb((db) => {
    db.workloadItems = [newItem, ...(db.workloadItems ?? [])];
  });

  return newItem;
}

export async function deferWorkloadItem(id: string): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    await supabase
      .from('workload_items')
      .update({ status: 'deferred' })
      .eq('id', id)
      .eq('user_id', userId);
  }

  await writeDb((db) => {
    const target = (db.workloadItems ?? []).find((i) => i.id === id);
    if (target) {
      target.status = 'deferred';
    }
  });
}

export async function completeWorkloadItem(id: string): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    await supabase
      .from('workload_items')
      .update({ status: 'completed' })
      .eq('id', id)
      .eq('user_id', userId);
  }

  await writeDb((db) => {
    const target = (db.workloadItems ?? []).find((item) => item.id === id);
    if (target) target.status = 'completed';
  });
}

export async function restoreWorkloadItem(id: string): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    await supabase
      .from('workload_items')
      .update({ status: 'scheduled' })
      .eq('id', id)
      .eq('user_id', userId);
  }

  await writeDb((db) => {
    const target = (db.workloadItems ?? []).find((i) => i.id === id);
    if (target) {
      target.status = 'scheduled';
    }
  });
}

export async function batchDeferWorkloadItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  if (hasSupabase) {
    const userId = await currentUserId();
    await supabase
      .from('workload_items')
      .update({ status: 'deferred' })
      .in('id', ids)
      .eq('user_id', userId);
  }

  await writeDb((db) => {
    for (const item of db.workloadItems ?? []) {
      if (ids.includes(item.id)) {
        item.status = 'deferred';
      }
    }
  });
}

export async function getCalendarConnections(): Promise<CalendarConnection[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('calendar_connections')
      .select('*')
      .eq('user_id', userId);

    if (data && data.length > 0) {
      return data.map((r) => ({
        provider: r.provider as 'google' | 'outlook',
        connected: r.connected,
        accountEmail: r.account_email,
        lastSyncedAt: r.last_synced_at,
      }));
    }
  }

  const db = await readDb();
  return db.calendarConnections ?? [];
}

function categoriseCalendarEvent(title: string): WorkloadCategory {
  const value = title.toLowerCase();
  if (/gym|run|workout|sport|walk|yoga|doctor|health/.test(value)) return 'physical';
  if (/coffee|dinner|party|meet|birthday|social|club/.test(value)) return 'social';
  if (/grocer|laundry|clean|shop|errand|bank|pickup/.test(value)) return 'errands';
  if (/meditat|breath|rest|read|downtime|therapy/.test(value)) return 'mental';
  return 'academic';
}

function priorityForCalendarEvent(title: string): WorkloadPriority {
  return /exam|deadline|due|presentation|interview|urgent/i.test(title) ? 'high' : 'medium';
}

function providerMatchesCalendar(calendar: { title?: string | null; ownerAccount?: string | null; source?: { name?: string | null } | null }, provider: 'google' | 'outlook') {
  const identity = [calendar.title, calendar.ownerAccount, calendar.source?.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return provider === 'google'
    ? /google|gmail/.test(identity)
    : /outlook|microsoft|office|exchange|hotmail|live\.com/.test(identity);
}

/**
 * Reads events from the device calendar account. Google Calendar and Outlook
 * both continuously sync into iOS/Android's system calendar, so this keeps
 * Wick out of the business of handling provider credentials or storing tokens.
 */
export async function syncCalendar(
  provider: 'google' | 'outlook'
): Promise<{ addedCount: number; items: WorkloadItem[] }> {
  if (Platform.OS === 'web') {
    throw new Error('Calendar sync needs a development build on a phone. Add tasks manually on web.');
  }

  const permission = await Calendar.requestCalendarPermissions(false);
  if (permission.status !== 'granted') {
    throw new Error('Calendar access is required to sync your schedule.');
  }

  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const matchingCalendars = calendars.filter((calendar) => providerMatchesCalendar(calendar, provider));
  if (matchingCalendars.length === 0) {
    throw new Error(`No ${provider === 'google' ? 'Google' : 'Outlook'} calendar is connected on this device.`);
  }

  const rangeStart = getMondayOfWeek();
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + 28);
  const events = await Calendar.listEvents(matchingCalendars, rangeStart, rangeEnd);
  const now = new Date().toISOString();
  const seedItems: WorkloadItem[] = events
    .filter((event) => !event.allDay && event.startDate && event.endDate && event.title)
    .map((event) => {
      const start = new Date(event.startDate);
      const end = new Date(event.endDate);
      const estimatedHours = Math.max(0.25, Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 4) / 4);
      return {
        // The deterministic ID makes resync replacement safe in the offline store.
        id: `${provider}-${event.id}`,
        title: event.title.trim(),
        category: categoriseCalendarEvent(event.title),
        estimatedHours,
        priority: priorityForCalendarEvent(event.title),
        source: provider,
        status: 'scheduled',
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        createdAt: now,
      };
    });
  const email = matchingCalendars[0].ownerAccount ?? null;

  if (hasSupabase) {
    const userId = await currentUserId();

    // 1. Record / update calendar connection
    await supabase.from('calendar_connections').upsert({
      user_id: userId,
      provider,
      connected: true,
      account_email: email,
      last_synced_at: now,
    });

    // 2. Remove existing items from this calendar source to avoid duplicates on re-sync
    await supabase
      .from('workload_items')
      .delete()
      .eq('user_id', userId)
      .eq('source', provider);

    // 3. Store the latest snapshot. Manual tasks are deliberately untouched.
    const rows = seedItems.map((item) => ({
      user_id: userId,
      title: item.title,
      category: item.category,
      estimated_hours: item.estimatedHours,
      priority: item.priority,
      source: item.source,
      status: item.status,
      scheduled_start: item.scheduledStart,
      scheduled_end: item.scheduledEnd,
    }));

    await supabase.from('workload_items').insert(rows);
  }

  // Update on-device local store
  await writeDb((db) => {
    // Upsert connection
    const existingConn = (db.calendarConnections ?? []).find(
      (c) => c.provider === provider
    );
    if (existingConn) {
      existingConn.connected = true;
      existingConn.lastSyncedAt = now;
      existingConn.accountEmail = email;
    } else {
      db.calendarConnections = [
        ...(db.calendarConnections ?? []),
        {
          provider,
          connected: true,
          accountEmail: email,
          lastSyncedAt: now,
        },
      ];
    }

    // Replace items from this source
    const withoutSource = (db.workloadItems ?? []).filter(
      (i) => i.source !== provider
    );
    db.workloadItems = [...seedItems, ...withoutSource];
  });

  return { addedCount: seedItems.length, items: seedItems };
}

export interface DailyLoad {
  dayIndex: number;
  dayLabel: string;
  fullDate: string;
  hours: number;
  capacityPct: number;
  taskCount: number;
  items: WorkloadItem[];
}

/**
 * Returns tasks clearly ranked by priority (High -> Medium -> Low),
 * urgency, and start time, with formatted day/time badges.
 */
export function getRankedTasks(items: WorkloadItem[]): RankedTask[] {
  const priorityWeight: Record<WorkloadPriority, number> = {
    high: 1,
    medium: 2,
    low: 3,
  };

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Sort scheduled first, then by priority, then by start time
  const sorted = [...items].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === 'scheduled') return -1;
      if (b.status === 'scheduled') return 1;
    }
    const pA = priorityWeight[a.priority] ?? 2;
    const pB = priorityWeight[b.priority] ?? 2;
    if (pA !== pB) return pA - pB;
    if (a.scheduledStart && b.scheduledStart) {
      return new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime();
    }
    return b.estimatedHours - a.estimatedHours;
  });

  return sorted.map((item, index) => {
    let dayName = 'Flexible';
    let timeFormatted = `${item.estimatedHours}h`;

    if (item.scheduledStart) {
      const d = new Date(item.scheduledStart);
      dayName = dayNames[d.getDay()];
      const hour = d.getHours();
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const formattedHour = hour % 12 === 0 ? 12 : hour % 12;
      timeFormatted = `${dayName} ${formattedHour}:00 ${ampm} • ${item.estimatedHours}h`;
    }

    return {
      ...item,
      rank: index + 1,
      dayName,
      timeFormatted,
    };
  });
}

/**
 * Calculates scheduled daily load hours and capacity % for Monday through Sunday.
 */
export function getDailyLoads(items: WorkloadItem[], baseDate: Date = new Date()): DailyLoad[] {
  const monday = getMondayOfWeek(baseDate);
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const scheduled = items.filter((i) => i.status === 'scheduled');

  const result: DailyLoad[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const dateStr = getLocalDateKey(d);

    // Find items scheduled for this day
    const dayItems = scheduled.filter((item) => {
      if (!item.scheduledStart) return false;
      const itemDate = getLocalDateKey(new Date(item.scheduledStart));
      return itemDate === dateStr;
    });

    const hours = Math.round(dayItems.reduce((acc, item) => acc + item.estimatedHours, 0) * 10) / 10;
    // Standard baseline for daily focus ~ 6 hours
    const capacityPct = Math.min(100, Math.round((hours / 6) * 100));

    result.push({
      dayIndex: i,
      dayLabel: dayLabels[i],
      fullDate: dateStr,
      hours,
      capacityPct,
      taskCount: dayItems.length,
      items: dayItems,
    });
  }

  return result;
}
