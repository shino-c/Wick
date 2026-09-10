/**
 * Calendar sync service – reads the user's phone system calendar for the
 * current week and persists the events as workload items under the active
 * Supabase user (or local demo store when offline).
 *
 * Built for Expo SDK 57 (expo-calendar ~57.0.3 Next API):
 *   1. connectCalendar() – prompts permission and marks the connection row.
 *   2. syncCalendarEvents() – fetches events for this week and calls
 *      createWorkloadItem for each event.
 *   3. getCalendarConnections() – reads connection status so the
 *      UI can show “Connected” / “Disconnected”.
 */

import { currentUserId, hasSupabase, supabase } from '@/lib/supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface CalendarConnection {
  provider: string;
  connected: boolean;
  accountEmail?: string;
  lastSyncedAt?: string;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  allDay?: boolean;
  location?: string | null;
  notes?: string | null;
}

export type CalendarSyncResult = CalendarEventItem[] & {
  saved: number;
  existing: number;
  error?: string;
  events: CalendarEventItem[];
};

const LOCAL_CALENDAR_KEY = 'wick.local.calendar_connections';

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust to Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6); // adjust to Sunday
  end.setHours(23, 59, 59, 999);
  return end;
}

function isCalendarAvailable(): boolean {
  return (
    Platform.OS !== 'web' &&
    Boolean(Calendar) &&
    typeof Calendar.getCalendarPermissions === 'function' &&
    typeof Calendar.requestCalendarPermissions === 'function'
  );
}

function createSyncResult(
  events: CalendarEventItem[],
  saved: number,
  existing: number,
  error?: string
): CalendarSyncResult {
  const arr = [...events] as CalendarSyncResult;
  arr.saved = saved;
  arr.existing = existing;
  arr.error = error;
  arr.events = events;
  return arr;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

export async function requestCalendarPermission(): Promise<'granted' | 'denied'> {
  if (!isCalendarAvailable()) {
    return 'denied';
  }
  try {
    const { status } = await Calendar.requestCalendarPermissions();
    return status === 'granted' ? 'granted' : 'denied';
  } catch (err) {
    console.warn('Failed to request calendar permissions:', err);
    return 'denied';
  }
}

export async function getCalendarPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (!isCalendarAvailable()) {
    return 'undetermined';
  }
  try {
    const { status } = await Calendar.getCalendarPermissions();
    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'undetermined';
  } catch (err) {
    console.warn('Failed to get calendar permissions:', err);
    return 'undetermined';
  }
}

export async function getCalendarConnections(): Promise<CalendarConnection[]> {
  if (hasSupabase) {
    try {
      const userId = await currentUserId();
      if (userId) {
        const { data, error } = await supabase
          .from('calendar_connections')
          .select('provider, connected, account_email, last_synced_at')
          .eq('user_id', userId);
        if (!error && data) {
          return data.map((r: any) => ({
            provider: r.provider,
            connected: Boolean(r.connected),
            accountEmail: r.account_email ?? undefined,
            lastSyncedAt: r.last_synced_at ?? undefined,
          }));
        }
      }
    } catch (err) {
      console.warn('Error reading calendar_connections from Supabase:', err);
    }
  }

  // Fallback to AsyncStorage for offline / demo mode
  try {
    const raw = await AsyncStorage.getItem(LOCAL_CALENDAR_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function connectCalendar(): Promise<void> {
  const permission = await requestCalendarPermission();
  if (permission !== 'granted') {
    if (isCalendarAvailable()) {
      throw new Error('Calendar permission not granted');
    }
    console.warn('Calendar native module unavailable; continuing in demo mode.');
  }

  const now = new Date().toISOString();

  if (hasSupabase) {
    const userId = await currentUserId();
    if (userId) {
      const { error } = await supabase.from('calendar_connections').upsert(
        {
          user_id: userId,
          provider: 'device',
          connected: true,
          account_email: undefined,
          last_synced_at: now,
        },
        { onConflict: 'user_id,provider' }
      );
      if (!error) return;
      console.warn('Supabase upsert calendar_connections failed:', error);
    }
  }

  // Local storage fallback
  const conns = await getCalendarConnections();
  const existingIdx = conns.findIndex(c => c.provider === 'device');
  const record: CalendarConnection = {
    provider: 'device',
    connected: true,
    accountEmail: undefined,
    lastSyncedAt: now,
  };
  if (existingIdx >= 0) {
    conns[existingIdx] = record;
  } else {
    conns.push(record);
  }
  await AsyncStorage.setItem(LOCAL_CALENDAR_KEY, JSON.stringify(conns));
}

export async function disconnectCalendar(): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (userId) {
      await supabase
        .from('calendar_connections')
        .delete()
        .eq('user_id', userId)
        .eq('provider', 'device');
      return;
    }
  }

  const conns = await getCalendarConnections();
  const filtered = conns.filter(c => c.provider !== 'device');
  await AsyncStorage.setItem(LOCAL_CALENDAR_KEY, JSON.stringify(filtered));
}

export async function syncCalendarEvents(): Promise<CalendarSyncResult> {
  // Ensure calendar is connected
  const connections = await getCalendarConnections();
  const deviceConn = connections.find(c => c.provider === 'device');
  if (!deviceConn || !deviceConn.connected) {
    return createSyncResult([], 0, 0, 'Calendar not connected');
  }

  if (
    !isCalendarAvailable() ||
    typeof Calendar.getCalendars !== 'function' ||
    typeof Calendar.listEvents !== 'function'
  ) {
    return createSyncResult([], 0, 0, 'Calendar module not available on this platform');
  }

  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);

  try {
    // 1. Fetch event calendars using Expo SDK 57 Next API
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes?.EVENT);
    if (!calendars || calendars.length === 0) {
      return createSyncResult([], 0, 0);
    }

    // 2. Fetch events across calendars for the week
    const rawEvents = await Calendar.listEvents(calendars, weekStart, weekEnd);

    const mappedEvents: CalendarEventItem[] = [];

    for (const ev of rawEvents) {
      const title = ev.title ?? 'Untitled event';
      const start = ev.startDate ? new Date(ev.startDate) : null;
      const end = ev.endDate ? new Date(ev.endDate) : null;

      if (!start) continue;

      mappedEvents.push({
        id: ev.id,
        title,
        startDate: start.toISOString(),
        endDate: end ? end.toISOString() : start.toISOString(),
        allDay: Boolean(ev.allDay),
        location: ev.location ?? null,
        notes: ev.notes ?? null,
      });

    }

    // Update last_synced_at timestamp
    const syncedAt = new Date().toISOString();
    if (hasSupabase) {
      const userId = await currentUserId();
      if (userId) {
        await supabase.from('calendar_connections').upsert(
          {
            user_id: userId,
            provider: 'device',
            connected: true,
            last_synced_at: syncedAt,
          },
          { onConflict: 'user_id,provider' }
        );
      }
    } else {
      const conns = await getCalendarConnections();
      const devIdx = conns.findIndex(c => c.provider === 'device');
      if (devIdx >= 0) {
        conns[devIdx].lastSyncedAt = syncedAt;
        await AsyncStorage.setItem(LOCAL_CALENDAR_KEY, JSON.stringify(conns));
      }
    }

    return createSyncResult(mappedEvents, 0, mappedEvents.length);
  } catch (err: any) {
    console.error('Calendar sync error:', err);
    return createSyncResult([], 0, 0, err.message ?? 'Unknown error');
  }
}

/* ── 2-Way Calendar Synchronization (Add / Delete) ────────────────────────── */

/**
 * Creates an event on the user's phone system calendar via Expo SDK 57 Next API.
 */
export async function addEventToDeviceCalendar(task: {
  title: string;
  scheduled_date: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  notes?: string;
}): Promise<string | null> {
  if (!isCalendarAvailable() || typeof Calendar.getCalendars !== 'function') {
    return null;
  }
  try {
    const calendars = await Calendar.getCalendars(Calendar.EntityTypes?.EVENT);
    if (!calendars || calendars.length === 0) return null;

    // Pick writable calendar (or first calendar)
    const targetCalendar =
      calendars.find((c) => c.allowsModifications) || calendars[0];

    const startTime = task.scheduled_start_time || '09:00';
    const endTime = task.scheduled_end_time || '10:00';
    const start = new Date(`${task.scheduled_date}T${startTime}`);
    const end = new Date(`${task.scheduled_date}T${endTime}`);

    const event = await targetCalendar.createEvent({
      title: task.title,
      startDate: start,
      endDate: end,
      notes: task.notes,
    });
    return event?.id || null;
  } catch (err) {
    console.warn('Failed to add event to device calendar:', err);
    return null;
  }
}

/**
 * Deletes an event from the user's phone system calendar.
 */
export async function deleteEventFromDeviceCalendar(calendarEventId?: string): Promise<boolean> {
  if (!calendarEventId || !isCalendarAvailable()) return false;
  try {
    const event = await Calendar.ExpoCalendarEvent.get(calendarEventId);
    if (event && typeof event.delete === 'function') {
      await event.delete();
      return true;
    }
  } catch (err) {
    console.warn('Failed to delete event from device calendar:', err);
  }
  return false;
}

/** Updates the matching native calendar event without creating a new event. */
export async function updateEventOnDeviceCalendar(
  calendarEventId: string | undefined,
  task: {
    title: string;
    scheduled_date: string;
    scheduled_start_time?: string;
    scheduled_end_time?: string;
  }
): Promise<boolean> {
  if (!calendarEventId || !isCalendarAvailable()) return false;
  try {
    const event = await Calendar.ExpoCalendarEvent.get(calendarEventId);
    if (!event || typeof event.update !== 'function') return false;

    await event.update({
      title: task.title,
      startDate: new Date(`${task.scheduled_date}T${task.scheduled_start_time || '09:00'}`),
      endDate: new Date(`${task.scheduled_date}T${task.scheduled_end_time || '10:00'}`),
    });
    return true;
  } catch (err) {
    console.error('Failed to update device calendar event:', err);
    return false;
  }
}

/**
 * Checks if the current week is newer than the recorded lastSyncedAt timestamp.
 */
export function isNewWeek(lastSyncedAt?: string): boolean {
  if (!lastSyncedAt) return true;
  const lastSyncDate = new Date(lastSyncedAt);
  const now = new Date();
  const lastSyncWeekStart = startOfWeek(lastSyncDate).getTime();
  const currentWeekStart = startOfWeek(now).getTime();
  return currentWeekStart > lastSyncWeekStart;
}