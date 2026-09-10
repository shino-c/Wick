import { readDb, uid, writeDb } from '@/data/localStore';
import type {
  AvailableSlot,
  ChallengeRow,
  DailyRecoveryPlan,
  GardenWallet,
  RecoveryDay,
  RecoveryPlanSession,
  RecoverySuggestion,
  TaskAnalysis,
} from '@/data/types';
import { currentUserId, hasSupabase, supabase } from '@/lib/supabaseClient';
import { generateDailyRecoveryPlan } from '@/services/aiService';
import { toISODate, todayISO } from '@/services/dateUtils';
import {
  earnSeeds,
  getBaseline,
  getGardenWallet,
  getTaskAnalyses,
  getWeeklyCapacity,
  listChallenges,
  listStressScores,
} from '@/services/repository';

const today = () => todayISO();

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

/** Minutes past midnight → "HH:MM" label for slot chips. */
const fmtHM = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * The user's real free windows today, computed from what is actually on their
 * schedule (approved, timed tasks for today) — never invented.
 */
export function computeAvailableSlots(tasks: TaskAnalysis[], date: string): AvailableSlot[] {
  const isAllDay = (t: TaskAnalysis): boolean => {
    if (t.allDay === true) return true;
    // All-day events sync as start/end "00:00" (their raw instants straddle
    // midnight), which the `end > start` check would otherwise drop — making a
    // fully-booked day look completely free.
    const start = toMinutes(t.scheduled_start_time);
    const end = toMinutes(t.scheduled_end_time);
    return start === 0 && end === 0;
  };

  const busy = tasks
    .filter((t) => {
      if (t.scheduled_date !== date) return false;
      if (t.status === 'rejected' || t.status === 'deferred' || t.status === 'completed') return false;
      const start = toMinutes(t.scheduled_start_time);
      const end = toMinutes(t.scheduled_end_time);
      if (isAllDay(t)) return true;
      return start !== null && end !== null && end > start;
    })
    .map((t) =>
      isAllDay(t)
        ? { start: DAY_START_MIN, end: DAY_END_MIN }
        : {
            start: Math.max(DAY_START_MIN, toMinutes(t.scheduled_start_time)!),
            end: Math.min(DAY_END_MIN, toMinutes(t.scheduled_end_time)!),
          }
    )
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

  const slots: AvailableSlot[] = [];
  let cursor = DAY_START_MIN;
  for (const block of merged) {
    if (block.start - cursor >= MIN_FREE_MINUTES) {
      slots.push({ start: fmtHM(cursor), end: fmtHM(block.start), minutes: block.start - cursor });
    }
    cursor = Math.max(cursor, block.end);
  }
  if (DAY_END_MIN - cursor >= MIN_FREE_MINUTES) {
    slots.push({ start: fmtHM(cursor), end: fmtHM(DAY_END_MIN), minutes: DAY_END_MIN - cursor });
  }
  return slots;
}

/**
 * A free window that is already over is not usable — a "plan today" should
 * never point at a gap in the past, and past gaps are the main reason a busy
 * day looks like it has "too many" slots. Keeps only windows with
 * MIN_FREE_MINUTES still remaining, clamping a window already in progress so
 * it reflects what is actually left.
 */
function prunePastSlots(slots: AvailableSlot[], date: string, now = new Date()): AvailableSlot[] {
  if (date !== toISODate(now)) return slots;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const kept: AvailableSlot[] = [];
  for (const slot of slots) {
    const start = toMinutes(slot.start);
    const end = toMinutes(slot.end);
    if (start === null || end === null || end <= nowMinutes) continue;
    const effectiveStart = Math.max(start, nowMinutes);
    const minutes = end - effectiveStart;
    if (minutes < MIN_FREE_MINUTES) continue;
    kept.push({ start: fmtHM(effectiveStart), end: slot.end, minutes });
  }
  return kept;
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
    return toISODate(date);
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
 * Only recommend plans that actually fit one of today's real free slots.
 * Each kept suggestion is re-anchored to the first slot its length fits;
 * anything that fits no slot is dropped, so a plan is never recommended
 * into busy time. No free slots today → nothing is recommended.
 */
function fitSuggestionsToSlots(
  suggestions: RecoverySuggestion[],
  slots: AvailableSlot[]
): RecoverySuggestion[] {
  if (slots.length === 0) return [];
  return suggestions
    .map((s) => ({ ...s, slot: slots.find((slot) => slot.minutes >= s.minutes) }))
    .filter((s): s is RecoverySuggestion & { slot: AvailableSlot } => s.slot !== undefined);
}

const CHALLENGE_EMOJI: Record<ChallengeRow['category'], string> = {
  physical: '🚶',
  social: '💬',
  mental: '🍵',
};

/** Best-guess length of a challenge until challenges carry a real duration. */
function challengeMinutes(ch: ChallengeRow): number {
  const match = /\b(\d+)\s*min\b/i.exec(ch.subtitle ?? '');
  if (match) return Math.max(5, Math.min(120, Number(match[1])));
  return ch.category === 'physical' ? 30 : 15;
}

/**
 * Turns a circle challenge into a recovery suggestion. The challenge becomes
 * one of today's three plans — a fixed plan with a set time, which is exactly
 * what a fully-booked day still has room for.
 */
function challengeToSuggestion(ch: ChallengeRow): RecoverySuggestion {
  const minutes = challengeMinutes(ch);
  return {
    id: `challenge:${ch.id}`,
    challengeId: ch.id,
    challengeJoined: ch.joined,
    challengeScheduledFor: ch.scheduledFor,
    emoji: CHALLENGE_EMOJI[ch.category],
    title: ch.title,
    detail: ch.notes ?? ch.subtitle,
    minutes,
    reason: ch.joined
      ? 'Your fixed plan with the circle — the time is already held for you.'
      : 'A shared challenge from your circle — a fixed time that holds even on a busy day.',
    targetType: 'minutes',
    targetValue: minutes,
    slot: undefined,
  };
}

/**
 * The circle challenge reserved as today's fixed plan. Prefers a challenge the
 * user already joined (a standing daily plan), then the first joinable one.
 */
function pickFixedChallenge(challenges: ChallengeRow[]): ChallengeRow | null {
  const candidates = challenges.filter(
    (ch) =>
      !ch.cancelled &&
      !ch.completedByMe &&
      (ch.capacity === null || ch.joinedCount < ch.capacity)
  );
  if (candidates.length === 0) return null;
  return candidates.find((ch) => ch.joined) ?? candidates[0];
}

/* ── Fixed, per-day plan cache ─────────────────────────────────────────────── */

/**
 * The plan for a day is generated once and frozen until midnight. These helpers
 * store it device-locally (same privacy posture as everything else) so opening
 * the Recovery tab is instant and consistent, and a started session is never
 * orphaned when the page is reopened.
 */
async function getCachedDailyRecoveryPlan(date: string): Promise<DailyRecoveryPlan | null> {
  const db = await readDb();
  return db.dailyRecoveryPlans.find((p) => p.date === date) ?? null;
}

async function saveDailyRecoveryPlan(date: string, plan: DailyRecoveryPlan): Promise<void> {
  await writeDb((db) => {
    // Keep packs from today and yesterday only — old days can never come back.
    const older = (db.dailyRecoveryPlans ?? []).filter((p) => p.date >= todayISO());
    db.dailyRecoveryPlans = [...older.filter((p) => p.date !== date), plan];
  });
}

/** Same shape as today, but with a given challenge's join state updated in place. */
function withChallengeState(
  plan: DailyRecoveryPlan,
  challengeId: string,
  joined: boolean
): DailyRecoveryPlan {
  return {
    ...plan,
    suggestions: plan.suggestions.map((s) =>
      s.challengeId === challengeId
        ? {
            ...s,
            challengeJoined: joined,
            reason: joined
              ? 'Your fixed plan with the circle — the time is already held for you.'
              : 'A shared challenge from your circle — a fixed time that holds even on a busy day.',
          }
        : s
    ),
  };
}

/**
 * After joining/leaving a challenge, update today's cached plan in place so the
 * fixed suggestion reflects the new state immediately — without regenerating
 * (and quietly reseeding) the whole day.
 */
export async function setChallengeJoinedForToday(
  challengeId: string,
  joined: boolean,
  date = today()
): Promise<DailyRecoveryPlan> {
  const plan = await getDailyRecoveryPlan(date);
  const updated = withChallengeState(plan, challengeId, joined);
  if (updated.suggestions.some((s) => s.challengeId === challengeId)) {
    await saveDailyRecoveryPlan(date, updated);
  }
  return updated;
}

/**
 * The day's plan, generated once and reused for the whole day. Reopening the
 * Recovery tab after that is instant and returns the exact same plans, so the
 * suggestion you started stays put and its tracked progress is never stranded
 * by a fresh random plan.
 */
export async function getDailyRecoveryPlan(date = today()): Promise<DailyRecoveryPlan> {
  const cached = await getCachedDailyRecoveryPlan(date);
  if (cached) return cached;

  const plan = await buildDailyRecoveryPlan(date);
  await saveDailyRecoveryPlan(date, plan);
  return plan;
}

/**
 * Generates a fresh plan from real signals — the expensive part (calendars,
 * capacity, stress and the AI), so it only runs once per day and the result is
 * cached by getDailyRecoveryPlan.
 */
async function buildDailyRecoveryPlan(date: string): Promise<DailyRecoveryPlan> {
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday, local
  const weekStartStr = toISODate(weekStart);

  const [capacity, baseline, scores, day] = await Promise.all([
    getWeeklyCapacity(weekStartStr),
    getBaseline(),
    listStressScores(7),
    getRecoveryDay(date),
  ]);

  // Load this week's analysed tasks. If the week-scoped query misses today
  // (older rows written with a UTC-shifted week_start, for example), fall back
  // to any real task scheduled for today so a full calendar is never reported
  // as free time.
  let tasks = await getTaskAnalyses(weekStartStr);
  if (!tasks.some((t) => t.scheduled_date === date)) {
    const todaysTasks = (await getTaskAnalyses()).filter((t) => t.scheduled_date === date);
    if (todaysTasks.length > 0) tasks = todaysTasks;
  }

  // Only windows with time still ahead of us are usable today.
  const slots = prunePastSlots(computeAvailableSlots(tasks, date), date);
  const latestScore = scores[0]?.fusedScore ?? null;
  const capacityPct = capacity
    ? Math.round((capacity.used_capacity_hours / Math.max(1, capacity.total_capacity_hours)) * 100)
    : 0;

  const plan = await generateDailyRecoveryPlan({
    date,
    slots,
    capacityPct,
    overloaded: capacity?.overload_warning ?? capacityPct >= 85,
    stressScore: latestScore,
    baseline: baseline.perceivedStressBaseline ?? null,
    completedToday: day.completedPlanIds,
  });

  // Reserve the first of the three plans for the circle challenge, then fill
  // the remaining two with gentle suggestions that really fit a free window.
  const fixedChallenge = pickFixedChallenge(await listChallenges());
  const slotSuggestions = fitSuggestionsToSlots(plan.suggestions, slots);

  const suggestions: RecoverySuggestion[] = [];
  if (fixedChallenge) suggestions.push(challengeToSuggestion(fixedChallenge));
  for (const suggestion of slotSuggestions) {
    if (suggestions.length >= 3) break;
    suggestions.push(suggestion);
  }

  return { ...plan, suggestions };
}

export { getGardenWallet };