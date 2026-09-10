import { readDb, uid, writeDb } from '@/data/localStore';
import type {
  AvailableSlot,
  DailyRecoveryPlan,
  GardenWallet,
  RecoveryDay,
  RecoveryPlanSession,
  RecoverySuggestion,
  TaskAnalysis,
} from '@/data/types';
import { currentUserId, hasSupabase, supabase } from '@/lib/supabaseClient';
import { generateDailyRecoveryPlan } from '@/services/aiService';
import {
  earnSeeds,
  getBaseline,
  getGardenWallet,
  getTaskAnalyses,
  getWeeklyCapacity,
  listStressScores,
} from '@/services/repository';

const today = () => new Date().toISOString().slice(0, 10);

const blankSession = (date: string): RecoveryPlanSession => ({
  id: uid(),
  date,
  planKey: '',
  title: '',
  emoji: '🌿',
  detail: null,
  targetType: 'none',
  targetValue: 0,
  progressValue: 0,
  status: 'started',
  startedAt: new Date().toISOString(),
  completedAt: null,
  rewardAwarded: false,
  createdAt: new Date().toISOString(),
});

/** Day window we consider "free time", so we never suggest meeting time at 2am. */
const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 22 * 60;
const MIN_FREE_MINUTES = 5;

const blankDay = (date: string): RecoveryDay => ({
  date,
  completedPlanIds: [],
  outdoorCompleted: false,
  recoveryPct: 0,
  updatedAt: new Date().toISOString(),
});

const fromRow = (row: any): RecoveryDay => ({
  date: row.recovery_date,
  completedPlanIds: row.completed_plan_ids ?? [],
  gameCompleted: row.game_completed ?? false,
  gameMinutes: row.game_minutes ?? 0,
  outdoorCompleted: row.outdoor_completed ?? false,
  recoveryEventId: row.recovery_event_id ?? null,
  recoveryEventStart: row.recovery_event_start ?? null,
  recoveryPct: row.recovery_pct ?? 0,
  updatedAt: row.updated_at ?? new Date().toISOString(),
});

const fromSessionRow = (row: any): RecoveryPlanSession => ({
  id: row.id ?? uid(),
  date: row.recovery_date,
  planKey: row.plan_key,
  title: row.title,
  emoji: row.emoji,
  detail: row.detail ?? null,
  targetType: row.target_type ?? 'minutes',
  targetValue: row.target_value ?? 0,
  progressValue: row.progress_value ?? 0,
  status: row.status ?? 'started',
  startedAt: row.started_at ?? new Date().toISOString(),
  completedAt: row.completed_at ?? null,
  rewardAwarded: row.reward_awarded ?? false,
  createdAt: row.created_at ?? new Date().toISOString(),
});

const toSessionRow = (session: RecoveryPlanSession) => ({
  user_id: undefined as string | undefined,
  recovery_date: session.date,
  plan_key: session.planKey,
  title: session.title,
  emoji: session.emoji,
  detail: session.detail ?? null,
  target_type: session.targetType,
  target_value: session.targetValue,
  progress_value: session.progressValue,
  status: session.status,
  started_at: session.startedAt,
  completed_at: session.completedAt ?? null,
  reward_awarded: session.rewardAwarded ?? false,
});

/**
 * Minutes already elapsed on a running minute-plan, from the real clock, so a
 * session keeps making progress even after a reload. Returns the raw session
 * when nothing changed.
 */
function reconcileSession(session: RecoveryPlanSession): RecoveryPlanSession {
  if (session.status !== 'started' || session.targetType !== 'minutes') return session;
  const elapsed = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 60000);
  const progress = Math.min(session.targetValue, Math.max(session.progressValue, elapsed));
  if (progress === session.progressValue) return session;
  return { ...session, progressValue: progress };
}

/** How many minutes past midnight an "HH:MM" string is. */
const toMinutes = (time: string | undefined): number | null => {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

/**
 * The user's real free windows today, computed from what is actually on their
 * schedule (approved, timed tasks for today) — never invented.
 */
export function computeAvailableSlots(tasks: TaskAnalysis[], date: string): AvailableSlot[] {
  const busy = tasks
    .filter((t) => {
      if (t.scheduled_date !== date) return false;
      if (t.status === 'rejected' || t.status === 'deferred' || t.status === 'completed') return false;
      const start = toMinutes(t.scheduled_start_time);
      const end = toMinutes(t.scheduled_end_time);
      return start !== null && end !== null && end > start;
    })
    .map((t) => ({
      start: Math.max(DAY_START_MIN, toMinutes(t.scheduled_start_time)!),
      end: Math.min(DAY_END_MIN, toMinutes(t.scheduled_end_time)!),
    }))
    .sort((a, b) => a.start - b.start);

  // Merge overlapping/adjacent blocks so free time is measured against real gaps.
  const merged: { start: number; end: number }[] = [];
  for (const block of busy) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end) {
      last.end = Math.max(last.end, block.end);
    } else {
      merged.push({ ...block });
    }
  }

  const fmt = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const slots: AvailableSlot[] = [];
  let cursor = DAY_START_MIN;
  for (const block of merged) {
    if (block.start - cursor >= MIN_FREE_MINUTES) {
      slots.push({ start: fmt(cursor), end: fmt(block.start), minutes: block.start - cursor });
    }
    cursor = Math.max(cursor, block.end);
  }
  if (DAY_END_MIN - cursor >= MIN_FREE_MINUTES) {
    slots.push({ start: fmt(cursor), end: fmt(DAY_END_MIN), minutes: DAY_END_MIN - cursor });
  }
  return slots;
}

export async function getRecoveryDay(date = today()): Promise<RecoveryDay> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) return blankDay(date);
    const { data, error } = await supabase
      .from('recovery_days')
      .select('*')
      .eq('user_id', userId)
      .eq('recovery_date', date)
      .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data) : blankDay(date);
  }
  const db = await readDb();
  return db.recoveryDays?.find((day) => day.date === date) ?? blankDay(date);
}

export async function getRecoveryWeek(): Promise<RecoveryDay[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date.toISOString().slice(0, 10);
  });
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) return dates.map(blankDay);
    const { data, error } = await supabase
      .from('recovery_days')
      .select('*')
      .eq('user_id', userId)
      .gte('recovery_date', dates[0])
      .lte('recovery_date', dates[dates.length - 1]);
    if (error) throw error;
    const rows = new Map((data ?? []).map((row: any) => [row.recovery_date, fromRow(row)]));
    return dates.map((date) => rows.get(date) ?? blankDay(date));
  }
  const db = await readDb();
  return dates.map((date) => db.recoveryDays?.find((day) => day.date === date) ?? blankDay(date));
}

async function updateDay(mutate: (day: RecoveryDay) => void): Promise<RecoveryDay> {
  const day = await getRecoveryDay();
  mutate(day);
  day.updatedAt = new Date().toISOString();
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) throw new Error('Sign in before saving recovery progress.');
    const payload = {
      user_id: userId,
      recovery_date: day.date,
      completed_plan_ids: day.completedPlanIds,
      game_completed: day.gameCompleted ?? false,
      game_minutes: day.gameMinutes ?? 0,
      outdoor_completed: day.outdoorCompleted,
      recovery_event_id: day.recoveryEventId ?? null,
      recovery_event_start: day.recoveryEventStart ?? null,
      recovery_pct: day.recoveryPct ?? 0,
      updated_at: day.updatedAt,
    };
    const { error } = await supabase.from('recovery_days').upsert(payload, { onConflict: 'user_id,recovery_date' });
    if (error) throw error;
    return day;
  }
  await writeDb((db) => {
    const index = db.recoveryDays?.findIndex((item) => item.date === day.date) ?? -1;
    if (index >= 0) db.recoveryDays![index] = day;
    else db.recoveryDays = [...(db.recoveryDays ?? []), day];
  });
  return day;
}

/* ── Recovery plan sessions ──────────────────────────────────────────
 * A plan is never finished by tapping a button. Sessions record real
 * measured progress (steps from the pedometer, minutes from a clock) and
 * the one-time seed reward is only granted once per completed plan.
 */

export async function getPlanSessions(date = today()): Promise<RecoveryPlanSession[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) return [];
    const { data, error } = await supabase
      .from('recovery_plan_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('recovery_date', date);
    if (error) throw error;
    return (data ?? []).map((row: any) => reconcileSession(fromSessionRow(row)));
  }
  const db = await readDb();
  return (db.recoveryPlanSessions ?? []).filter((session) => session.date === date).map(reconcileSession);
}

export async function getPlanSession(planKey: string, date = today()): Promise<RecoveryPlanSession | null> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) return null;
    const { data, error } = await supabase
      .from('recovery_plan_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('recovery_date', date)
      .eq('plan_key', planKey)
      .maybeSingle();
    if (error) throw error;
    return data ? reconcileSession(fromSessionRow(data)) : null;
  }
  const db = await readDb();
  const session = (db.recoveryPlanSessions ?? []).find((item) => item.date === date && item.planKey === planKey);
  return session ? reconcileSession(session) : null;
}

async function saveSession(session: RecoveryPlanSession): Promise<RecoveryPlanSession> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) throw new Error('Sign in before starting a recovery plan.');
    const row = toSessionRow(session);
    row.user_id = userId;
    const { error } = await supabase
      .from('recovery_plan_sessions')
      .upsert(row, { onConflict: 'user_id,recovery_date,plan_key' });
    if (error) throw error;
    return session;
  }
  await writeDb((db) => {
    const index = (db.recoveryPlanSessions ?? []).findIndex(
      (item) => item.date === session.date && item.planKey === session.planKey
    );
    if (index >= 0) db.recoveryPlanSessions![index] = session;
    else db.recoveryPlanSessions = [...(db.recoveryPlanSessions ?? []), session];
  });
  return session;
}

/**
 * Start a plan. Safe to call again — a completed plan stays completed, and a
 * running plan simply restarts from zero so progress always reflects a real
 * attempt made now.
 */
export async function startPlanSession(suggestion: RecoverySuggestion, date = today()): Promise<RecoveryPlanSession> {
  const existing = await getPlanSession(suggestion.id, date);
  if (existing?.status === 'completed') return existing;
  const now = new Date().toISOString();
  const session: RecoveryPlanSession = {
    id: existing?.id ?? uid(),
    date,
    planKey: suggestion.id,
    title: suggestion.title,
    emoji: suggestion.emoji,
    detail: suggestion.detail ?? null,
    targetType: suggestion.targetType,
    targetValue: suggestion.targetValue,
    progressValue: 0,
    status: 'started',
    startedAt: now,
    completedAt: null,
    rewardAwarded: false,
    createdAt: existing?.createdAt ?? now,
  };
  return saveSession(session);
}

/** Persist a new measured progress value. Completed sessions are never regressed. */
export async function updatePlanProgress(
  planKey: string,
  progress: number,
  date = today()
): Promise<RecoveryPlanSession | null> {
  const session = await getPlanSession(planKey, date);
  if (!session || session.status === 'completed') return session;
  const clamped = Math.max(0, Math.round(progress));
  if (clamped === session.progressValue) return session;
  return saveSession({ ...session, progressValue: clamped });
}

/**
 * Mark a plan completed — but only when tracked progress has really reached
 * the target. The seed reward is granted exactly once per plan, guarded by
 * the persisted `rewardAwarded` flag so a double-tap or reload can't farm it.
 */
export async function completePlanSession(
  planKey: string,
  date = today(),
  rewardSeeds = 10
): Promise<{ session: RecoveryPlanSession; wallet: GardenWallet; day: RecoveryDay }> {
  let session = await getPlanSession(planKey, date);
  if (!session) throw new Error('Start a plan before completing it.');

  if (session.status === 'started') {
    if (session.progressValue < session.targetValue) {
      throw new Error('The plan is not finished yet — keep going gently.');
    }
    session = await saveSession({
      ...session,
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
  }

  const wallet = await getGardenWallet();
  if (session.rewardAwarded) {
    return { session, wallet, day: await getRecoveryDay(date) };
  }

  session = await saveSession({ ...session, rewardAwarded: true });
  const earned = await earnSeeds(rewardSeeds);
  const day = await updateDay((d) => {
    if (!d.completedPlanIds.includes(planKey)) d.completedPlanIds.push(planKey);
  });
  return { session, wallet: earned, day };
}

/** One real minute of a recovery game (Bubble Pop) → recorded honestly. */
export async function recordGameMinute(): Promise<RecoveryDay> {
  return updateDay((d) => {
    const minutes = (d.gameMinutes ?? 0) + 1;
    d.gameMinutes = minutes;
    d.recoveryPct = Math.min(100, Math.round(minutes * 5));
    d.gameCompleted = minutes >= 1;
  });
}

export type { DailyRecoveryPlan };

/**
 * Today's plan, built from real signals:
 * today's scheduled free time, this week's capacity, recent stress, baseline,
 * and what is already done. Suggestions are optional and always fit a slot.
 */
export async function getDailyRecoveryPlan(date = today()): Promise<DailyRecoveryPlan> {
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const [tasks, capacity, baseline, scores, day] = await Promise.all([
    getTaskAnalyses(weekStartStr),
    getWeeklyCapacity(weekStartStr),
    getBaseline(),
    listStressScores(7),
    getRecoveryDay(date),
  ]);

  const slots = computeAvailableSlots(tasks, date);
  const latestScore = scores[0]?.fusedScore ?? null;
  const capacityPct = capacity
    ? Math.round((capacity.used_capacity_hours / Math.max(1, capacity.total_capacity_hours)) * 100)
    : 0;

  return generateDailyRecoveryPlan({
    date,
    slots,
    capacityPct,
    overloaded: capacity?.overload_warning ?? capacityPct >= 85,
    stressScore: latestScore,
    baseline: baseline.perceivedStressBaseline ?? null,
    completedToday: day.completedPlanIds,
  });
}

export { getGardenWallet };