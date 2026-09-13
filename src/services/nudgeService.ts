/**
 * nudgeService.ts — the single suggestion engine.
 *
 * Desk Mode, Recovery, the circle's challenges and the baseline gate each have
 * a reason to interrupt the user. Built separately they would each be defensible
 * and collectively a nag, and they would all fire hardest on the same day — the
 * overloaded, high-stress one, when the user can least absorb three popups.
 *
 * So there is one engine. Every source contributes *candidates*; they are scored
 * on one comparable scale, arbitrated against each other, put through one set of
 * gates, and at most one survives.
 *
 * Two design commitments worth stating, because they are easy to erode later:
 *
 *  1. Candidate generation is deterministic. Free-slot arithmetic, days-to-
 *     deadline and category debt decide *whether* to speak; the AI only decides
 *     *how it sounds*, and only after the fact (see phraseNudge in aiService).
 *     A popup cannot wait on a network round trip, and "should we interrupt
 *     this person" is not a question that should be untestable.
 *
 *  2. The gates are not decoration. The difference between a feature people keep
 *     and one they switch off is entirely in the caps, cooldowns and fatigue
 *     rules below — not in how clever the scoring is.
 */

import { readDb, uid, writeDb } from '@/data/localStore';
import type {
  AvailableSlot,
  Baseline,
  ChallengeRow,
  Nudge,
  NudgeEvent,
  NudgeKind,
  NudgeOutcome,
  TaskAnalysis,
  WeeklyCapacityAnalysis,
} from '@/data/types';
import { toISODate } from '@/services/dateUtils';
import { BASELINE_MIN_SCANS } from '@/services/ppgService';
import {
  DAY_END_MIN,
  DAY_START_MIN,
  computeAvailableSlots,
  getRecoveryDay,
  prunePastSlots,
} from '@/services/recoveryService';
import {
  focusMinutesSince,
  getBaseline,
  getTaskAnalyses,
  getWeeklyCapacity,
  listChallenges,
  listStressScores,
} from '@/services/repository';

/* ── Gates ──────────────────────────────────────────────────────────
 * Tuned to be conservative. Staying quiet costs a missed opportunity;
 * over-firing costs the whole feature.
 */

/** Hard ceiling. No signal, however strong, buys a third interruption. */
const MAX_PER_DAY = 2;
/** Minimum silence between two nudges of any kind. */
const MIN_GAP_MS = 3 * 3_600_000;
/** A dismissed nudge cannot return for this long, by id. */
const DISMISS_COOLDOWN_MS = 24 * 3_600_000;
/** "Later" is a softer no, so it earns a shorter silence. */
const SNOOZE_COOLDOWN_MS = 4 * 3_600_000;
/** Dismiss a kind this many times in a row and Wick stops offering that kind. */
const KIND_FATIGUE_DISMISSALS = 3;
const KIND_FATIGUE_MS = 7 * 86_400_000;
/** Nothing below this is worth an interruption. */
const MIN_SCORE = 0.18;

/** A focus block shorter than this is not worth the ceremony of Desk Mode. */
const MIN_DESK_MINUTES = 25;
/** The block offered when the user is calm and a deadline is close. */
const FULL_DESK_MINUTES = 45;
/** The block offered when the deadline is close but so is the user's ceiling. */
const SHORT_DESK_MINUTES = 15;
/** A gap starting this soon counts as "now". */
const SLOT_LOOKAHEAD_MIN = 15;
/** How close a joined challenge has to be before Wick mentions it. */
const CHALLENGE_LEAD_MIN = 45;

/** Stress at or above this is "high" even without a personal baseline. */
const STRESS_HIGH_ABSOLUTE = 60;
/** …or this far above the user's own normal, which matters more. */
const STRESS_HIGH_OVER_BASELINE = 10;
/** A desk candidate this strong counts as real deadline pressure. */
const URGENCY_HIGH = 0.25;

/** Categories a focus block can plausibly serve. Nobody needs Desk Mode for groceries. */
const FOCUSABLE = new Set(['academic', 'work']);
/** Tasks in these states are live commitments; the rest are noise. */
const LIVE_STATUSES = new Set(['pending', 'approved', 'scheduled']);

const PRIORITY_WEIGHT: Record<string, number> = { high: 1, medium: 0.6, low: 0.3 };

/* ── Time helpers ───────────────────────────────────────────────── */

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

const toMinutes = (time?: string): number | null => {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};

const fmt12 = (minutes: number): string => {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')}${h24 < 12 ? 'am' : 'pm'}`;
};

/** Whole days from today to an ISO date, negative for the past. */
function daysUntil(isoDate: string, now = new Date()): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

function dayLabel(isoDate: string, now = new Date()): string {
  const diff = daysUntil(isoDate, now);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString([], { weekday: 'long' });
}

/* ── Recurrence ─────────────────────────────────────────────────────
 *
 * A weekly lecture is not a deadline, but nothing in a synced event carries a
 * recurrence rule — expo-calendar's listEvents expands occurrences and the sync
 * in calendarSync.ts keeps only title/start/end. So recurrence is inferred the
 * only way it can be: the same title landing on three or more distinct days
 * inside one week is a timetable, not something to cram for.
 */
function recurringTitles(tasks: TaskAnalysis[]): Set<string> {
  const dates = new Map<string, Set<string>>();
  for (const t of tasks) {
    const key = normaliseTitle(t.title);
    if (!dates.has(key)) dates.set(key, new Set());
    dates.get(key)!.add(t.scheduled_date);
  }
  const out = new Set<string>();
  for (const [key, days] of dates) if (days.size >= 3) out.add(key);
  return out;
}

export function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/* ── Category overrides ─────────────────────────────────────────────
 * "CS101" tells the classifier nothing. When the user corrects a category once,
 * that correction has to outlive the calendar row, which is recreated from
 * scratch on every sync — so it is remembered by title, not by id.
 */

export async function rememberCategoryOverride(title: string, category: string): Promise<void> {
  await writeDb((db) => {
    db.categoryOverrides = { ...(db.categoryOverrides ?? {}), [normaliseTitle(title)]: category };
  });
}

export async function getCategoryOverrides(): Promise<Record<string, string>> {
  return (await readDb()).categoryOverrides ?? {};
}

/** The task's category, with the user's own correction winning. */
function effectiveCategory(task: TaskAnalysis, overrides: Record<string, string>): string {
  return overrides[normaliseTitle(task.title)] ?? task.category;
}

/* ── The ledger ─────────────────────────────────────────────────── */

export async function listNudgeEvents(limit = 50): Promise<NudgeEvent[]> {
  const db = await readDb();
  return [...(db.nudgeEvents ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

async function recordEvent(nudge: Nudge, outcome: NudgeOutcome): Promise<void> {
  const event: NudgeEvent = {
    id: uid(),
    nudgeId: nudge.id,
    kind: nudge.kind,
    outcome,
    score: nudge.score,
    title: nudge.title,
    body: nudge.body,
    at: new Date().toISOString(),
  };
  await writeDb((db) => {
    // 30 days is enough to compute acceptance and enforce every cooldown above.
    const cutoff = Date.now() - 30 * 86_400_000;
    db.nudgeEvents = [...(db.nudgeEvents ?? []), event].filter(
      (e) => new Date(e.at).getTime() >= cutoff
    );
  });
}

/** The user acted on it. */
export const acceptNudge = (nudge: Nudge) => recordEvent(nudge, 'accepted');
/** The user waved it away. Silences this exact nudge for a day. */
export const dismissNudge = (nudge: Nudge) => recordEvent(nudge, 'dismissed');
/** "Later." A softer no with a shorter silence. */
export const snoozeNudge = (nudge: Nudge) => recordEvent(nudge, 'snoozed');

/**
 * Acceptance rate, which is the only honest read on whether the engine helps.
 * Without it you are guessing, and the temptation is always to nudge more.
 */
export async function nudgeStats(days = 30): Promise<{
  shown: number;
  accepted: number;
  dismissed: number;
  snoozed: number;
  acceptanceRate: number | null;
  byKind: Record<string, { shown: number; accepted: number }>;
}> {
  const cutoff = Date.now() - days * 86_400_000;
  const events = (await listNudgeEvents(500)).filter((e) => new Date(e.at).getTime() >= cutoff);
  const shown = events.filter((e) => e.outcome === 'shown').length;
  const accepted = events.filter((e) => e.outcome === 'accepted').length;
  const byKind: Record<string, { shown: number; accepted: number }> = {};
  for (const e of events) {
    if (!byKind[e.kind]) byKind[e.kind] = { shown: 0, accepted: 0 };
    if (e.outcome === 'shown') byKind[e.kind].shown += 1;
    if (e.outcome === 'accepted') byKind[e.kind].accepted += 1;
  }
  return {
    shown,
    accepted,
    dismissed: events.filter((e) => e.outcome === 'dismissed').length,
    snoozed: events.filter((e) => e.outcome === 'snoozed').length,
    acceptanceRate: shown > 0 ? accepted / shown : null,
    byKind,
  };
}

/* ── Gate evaluation ────────────────────────────────────────────── */

interface GateVerdict {
  allowed: boolean;
  /** Plain-language reason, so a debug view can say why it stayed quiet. */
  reason: string;
  suppressedKinds: Set<NudgeKind>;
  suppressedIds: Set<string>;
}

function evaluateGates(events: NudgeEvent[], now: Date): GateVerdict {
  const suppressedKinds = new Set<NudgeKind>();
  const suppressedIds = new Set<string>();
  const ms = now.getTime();

  for (const e of events) {
    const age = ms - new Date(e.at).getTime();
    if (e.outcome === 'dismissed' && age < DISMISS_COOLDOWN_MS) suppressedIds.add(e.nudgeId);
    if (e.outcome === 'snoozed' && age < SNOOZE_COOLDOWN_MS) suppressedIds.add(e.nudgeId);
  }

  // Per-kind fatigue: N dismissals in a row, with no acceptance since, and the
  // kind goes quiet for a week. One rule, and the one that decides whether this
  // feature survives contact with a user who does not want it.
  const kinds: NudgeKind[] = ['desk', 'recovery', 'challenge', 'spot_check'];
  for (const kind of kinds) {
    const recent = events
      .filter((e) => e.kind === kind && e.outcome !== 'shown')
      .filter((e) => ms - new Date(e.at).getTime() < KIND_FATIGUE_MS)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    let streak = 0;
    for (const e of recent) {
      if (e.outcome === 'dismissed') streak += 1;
      else break;
    }
    if (streak >= KIND_FATIGUE_DISMISSALS) suppressedKinds.add(kind);
  }

  const minute = minutesOfDay(now);
  if (minute < DAY_START_MIN || minute >= DAY_END_MIN) {
    return { allowed: false, reason: 'outside waking hours', suppressedKinds, suppressedIds };
  }

  const shownToday = events.filter(
    (e) => e.outcome === 'shown' && toISODate(new Date(e.at)) === toISODate(now)
  );
  if (shownToday.length >= MAX_PER_DAY) {
    return { allowed: false, reason: 'daily cap reached', suppressedKinds, suppressedIds };
  }

  const lastShown = events
    .filter((e) => e.outcome === 'shown')
    .reduce<number>((max, e) => Math.max(max, new Date(e.at).getTime()), 0);
  if (lastShown > 0 && ms - lastShown < MIN_GAP_MS) {
    return { allowed: false, reason: 'too soon after the last one', suppressedKinds, suppressedIds };
  }

  return { allowed: true, reason: 'ok', suppressedKinds, suppressedIds };
}

/* ── Context ────────────────────────────────────────────────────── */

interface NudgeContext {
  now: Date;
  date: string;
  tasks: TaskAnalysis[];
  overrides: Record<string, string>;
  recurring: Set<string>;
  /** Free windows from now on, ignoring all-day markers (see buildContext). */
  slots: AvailableSlot[];
  /** The window we are in, or about to enter. */
  slotNow: AvailableSlot | null;
  freeMinutesNow: number;
  /** True when right now falls inside a real, timed commitment. */
  inBusyBlock: boolean;
  baseline: Baseline;
  stress: number | null;
  capacity: WeeklyCapacityAnalysis | null;
  capacityPct: number;
  overloaded: boolean;
  challenges: ChallengeRow[];
  focusByTask: Record<string, number>;
  focusByCategory: Record<string, number>;
  recoveryDoneToday: boolean;
}

async function buildContext(now: Date): Promise<NudgeContext> {
  const date = toISODate(now);
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));

  const [allTasks, baseline, scores, capacity, challenges, focus, day, overrides] =
    await Promise.all([
      getTaskAnalyses(toISODate(weekStart)),
      getBaseline(),
      listStressScores(5),
      getWeeklyCapacity(toISODate(weekStart)),
      listChallenges(),
      focusMinutesSince(7),
      getRecoveryDay(date),
      getCategoryOverrides(),
    ]);

  const tasks = allTasks.filter((t) => LIVE_STATUSES.has(t.status));

  /**
   * All-day events are markers, not commitments. computeAvailableSlots treats
   * them as blocking the whole day, which is right for "should I recommend a
   * 30-minute walk" — but fatal here: an exam logged as an all-day event
   * produces zero free windows, so the focus nudge would go silent on exactly
   * the day it matters most. For nudging they are excluded from the busy set
   * and used only as deadlines.
   */
  const timed = tasks.filter((t) => {
    if (t.allDay) return false;
    const s = toMinutes(t.scheduled_start_time);
    const e = toMinutes(t.scheduled_end_time);
    return s !== null && e !== null && e > s;
  });

  const slots = prunePastSlots(computeAvailableSlots(timed, date), date, now);
  const minute = minutesOfDay(now);

  const inBusyBlock = timed.some((t) => {
    if (t.scheduled_date !== date) return false;
    const s = toMinutes(t.scheduled_start_time)!;
    const e = toMinutes(t.scheduled_end_time)!;
    return minute >= s && minute < e;
  });

  const slotNow =
    slots.find((s) => {
      const start = toMinutes(s.start);
      return start !== null && start <= minute + SLOT_LOOKAHEAD_MIN;
    }) ?? null;

  const capacityPct = capacity
    ? Math.round((capacity.used_capacity_hours / Math.max(1, capacity.total_capacity_hours)) * 100)
    : 0;

  return {
    now,
    date,
    tasks,
    overrides,
    recurring: recurringTitles(allTasks),
    slots,
    slotNow,
    freeMinutesNow: slotNow?.minutes ?? 0,
    inBusyBlock,
    baseline,
    stress: scores[0]?.fusedScore ?? null,
    capacity,
    capacityPct,
    overloaded: capacity?.overload_warning ?? capacityPct >= 85,
    challenges,
    focusByTask: focus.byTask,
    focusByCategory: focus.byCategory,
    recoveryDoneToday: (day.completedPlanIds?.length ?? 0) > 0 || Boolean(day.gameCompleted),
  };
}

/** True when the user is measurably above their own normal, or high outright. */
function stressIsHigh(ctx: NudgeContext): boolean {
  if (ctx.stress === null) return false;
  const base = ctx.baseline.perceivedStressBaseline;
  if (base !== null && ctx.stress >= base + STRESS_HIGH_OVER_BASELINE) return true;
  return ctx.stress >= STRESS_HIGH_ABSOLUTE;
}

/** Minutes left in the current free window, clamped to what is left of the day. */
function usableMinutes(ctx: NudgeContext): number {
  const endOfDay = DAY_END_MIN - minutesOfDay(ctx.now);
  return Math.max(0, Math.min(ctx.freeMinutesNow, endOfDay));
}

/** A free window's end as an instant, so a stale nudge can expire itself. */
function slotEnd(ctx: NudgeContext): string {
  const end = toMinutes(ctx.slotNow?.end) ?? DAY_END_MIN;
  const at = new Date(ctx.now);
  at.setHours(Math.floor(end / 60), end % 60, 0, 0);
  return at.toISOString();
}

/* ── Candidates ─────────────────────────────────────────────────── */

interface DeskCandidate {
  nudge: Nudge;
  task: TaskAnalysis;
  category: string;
}

/**
 * The focus candidate.
 *
 *   urgency  = 1 / days until the deadline   — Friday exam seen on Wednesday → 0.5
 *   weight   = the task's own priority
 *   fit      = is there actually a usable window right now
 *   debt     = how much of the estimate is still unspent
 *
 * Note what urgency is measured against. A calendar holds events, not deadlines:
 * an exam is a two-hour block on Friday, but the *work* is all the days before
 * it. So the score runs backwards from the event and peaks as it approaches,
 * rather than firing on the day itself, when it is far too late to help.
 */
function deskCandidate(ctx: NudgeContext): DeskCandidate | null {
  if (ctx.inBusyBlock) return null;

  const minutes = usableMinutes(ctx);
  if (minutes < MIN_DESK_MINUTES) return null;

  let best: { task: TaskAnalysis; score: number } | null = null;

  for (const task of ctx.tasks) {
    if (!FOCUSABLE.has(effectiveCategory(task, ctx.overrides))) continue;
    if (ctx.recurring.has(normaliseTitle(task.title))) continue;

    const days = daysUntil(task.scheduled_date, ctx.now);
    // Six days, not seven: at exactly a week out dayLabel() would say the same
    // weekday as today, and "your exam is Friday" on a Friday reads as *this*
    // Friday. Anything a week away is not urgent enough to be worth the
    // ambiguity.
    if (days < 0 || days > 6) continue;

    const urgency = 1 / Math.max(1, days);
    const weight = PRIORITY_WEIGHT[task.priority] ?? 0.5;
    const fit = Math.min(1, minutes / FULL_DESK_MINUTES);

    const estimateMinutes = Math.max(30, (task.estimated_duration_hours || 1) * 60);
    const spent = ctx.focusByTask[task.id] ?? 0;
    const debt = Math.max(0, 1 - spent / estimateMinutes);
    if (debt <= 0.05) continue; // Already put the hours in. Leave them alone.

    const score = urgency * weight * fit * debt;
    if (!best || score > best.score) best = { task, score };
  }

  if (!best) return null;

  const { task, score } = best;
  const when = dayLabel(task.scheduled_date, ctx.now);
  const blockMinutes = Math.min(FULL_DESK_MINUTES, Math.floor(minutes / 5) * 5);
  const category = effectiveCategory(task, ctx.overrides);

  return {
    task,
    category,
    nudge: {
      id: `desk:task:${task.id}`,
      kind: 'desk',
      score,
      title: 'Want to focus right now?',
      body: `${task.title} is ${when}, and you have ${minutes} free minutes. A ${blockMinutes}-minute block would take a real bite out of it.`,
      evidence: `${task.title} · ${when} · ${minutes} min free now`,
      action: {
        label: `Start ${blockMinutes} min`,
        href: '/desk',
        params: {
          minutes: String(blockMinutes),
          taskId: task.id,
          taskTitle: task.title,
          category,
        },
      },
      expiresAt: slotEnd(ctx),
      createdAt: ctx.now.toISOString(),
    },
  };
}

/** The pause candidate: elevated stress, a heavy week, nothing done yet today. */
function recoveryCandidate(ctx: NudgeContext): Nudge | null {
  if (ctx.recoveryDoneToday) return null;
  const minutes = usableMinutes(ctx);
  if (minutes < 5) return null;

  const base = ctx.baseline.perceivedStressBaseline;
  const over = ctx.stress !== null && base !== null ? Math.max(0, ctx.stress - base) : 0;
  const elevation =
    ctx.stress === null ? 0 : Math.max(over / 40, Math.max(0, ctx.stress - 50) / 50);
  const overload = ctx.overloaded ? 1 : Math.max(0, ctx.capacityPct - 60) / 40;

  const score = Math.min(1, 0.6 * elevation + 0.4 * overload) * Math.min(1, minutes / 15);
  if (score <= 0) return null;

  const reason = ctx.overloaded
    ? `This week is at ${ctx.capacityPct}% of your capacity`
    : ctx.stress !== null
      ? `Your stress is reading ${Math.round(ctx.stress)}`
      : 'You have some open time';

  return {
    id: `recovery:${ctx.date}`,
    kind: 'recovery',
    score,
    title: 'Room for a pause?',
    body: `${reason}, and there are ${minutes} quiet minutes here. Nothing you have to do — just an opening.`,
    evidence: `${reason} · ${minutes} min free now`,
    action: { label: 'See today’s plan', href: '/recovery' },
    expiresAt: slotEnd(ctx),
    createdAt: ctx.now.toISOString(),
  };
}

/**
 * The challenge candidate.
 *
 * Two shapes, and only two. A challenge you already joined that starts shortly
 * is the highest-confidence nudge in the engine — you asked for it, the time is
 * fixed, and it is about to pass. Offering one you have *not* joined is a much
 * weaker claim, so it needs a genuinely quiet week in that category to justify
 * itself.
 */
function challengeCandidate(ctx: NudgeContext): Nudge | null {
  const live = ctx.challenges.filter((c) => !c.cancelled && !c.completedByMe);

  for (const ch of live) {
    if (!ch.joined || !ch.scheduledFor) continue;
    const at = new Date(ch.scheduledFor);
    // Legacy free-text schedules ("This weekend") carry no instant to count
    // down to, and guessing one would invent a commitment the user never made.
    if (Number.isNaN(at.getTime())) continue;
    const lead = (at.getTime() - ctx.now.getTime()) / 60_000;
    if (lead < 0 || lead > CHALLENGE_LEAD_MIN) continue;
    return {
      id: `challenge:starting:${ch.id}`,
      kind: 'challenge',
      score: 0.9,
      title: `${ch.title} starts in ${Math.round(lead)} min`,
      body: ch.location ? `At ${ch.location}. Still on?` : 'Still on?',
      evidence: `Joined · ${fmt12(minutesOfDay(at))}`,
      action: { label: 'Open it', href: '/challenge', params: { id: ch.id } },
      expiresAt: at.toISOString(),
      createdAt: ctx.now.toISOString(),
    };
  }

  // The soft offer. Only when that side of life has been genuinely quiet.
  const minutes = usableMinutes(ctx);
  if (minutes < 15 || ctx.inBusyBlock) return null;

  const joinable = live.filter(
    (c) => !c.joined && (c.capacity === null || c.joinedCount < c.capacity)
  );
  if (joinable.length === 0) return null;

  const socialMinutes = (ctx.focusByCategory.social ?? 0) + (ctx.focusByCategory.physical ?? 0);
  const scheduledSocial = ctx.tasks.filter((t) =>
    ['social', 'physical'].includes(effectiveCategory(t, ctx.overrides))
  ).length;
  if (socialMinutes > 0 || scheduledSocial >= 2) return null; // Not actually short on it.

  const ch = joinable[0];
  return {
    id: `challenge:join:${ch.id}`,
    kind: 'challenge',
    score: 0.3,
    title: 'Your circle has something on',
    body: `${ch.title} — ${ch.subtitle}. Nothing social or physical on your week so far.`,
    evidence: `${ch.joinedCount} joined · ${minutes} min free now`,
    action: { label: 'Take a look', href: '/challenge', params: { id: ch.id } },
    expiresAt: slotEnd(ctx),
    createdAt: ctx.now.toISOString(),
  };
}

/**
 * Never point at a locked door. Desk Mode tracks heart rate before the baseline
 * exists but cannot classify stress or move a break — so below that gate the
 * honest nudge is the spot check that lifts it, not "start focusing".
 */
function spotCheckCandidate(ctx: NudgeContext): Nudge | null {
  const done = ctx.baseline.calibrationScans;
  if (done >= BASELINE_MIN_SCANS) return null;
  if (ctx.inBusyBlock || usableMinutes(ctx) < 5) return null;

  const left = BASELINE_MIN_SCANS - done;
  return {
    id: `spot_check:${ctx.date}`,
    kind: 'spot_check',
    score: 0.35,
    title: 'Two quiet minutes?',
    body: `${left} more spot check${left === 1 ? '' : 's'} and Wick knows your normal — that is when Desk Mode can start moving your breaks for you.`,
    evidence: `${done}/${BASELINE_MIN_SCANS} spot checks done`,
    action: { label: 'Do a spot check', href: '/spot-check' },
    expiresAt: slotEnd(ctx),
    createdAt: ctx.now.toISOString(),
  };
}

/* ── Arbitration ────────────────────────────────────────────────── */

/**
 * The part that is actually the product.
 *
 * A naive engine takes the highest score, and on the worst possible day — exam
 * Friday, stress reading 78 — that is the focus nudge. Which means a stress app
 * would be telling an already-overloaded student to push harder: the single
 * thing it exists not to do.
 *
 * So when deadline pressure and stress are both high, recovery leads and the
 * focus block is kept, shortened, as the second offer. Five minutes down, then
 * one short block. The user is not being told to stop working — the order is
 * simply the other way round, and both doors stay open.
 */
function arbitrate(
  ctx: NudgeContext,
  desk: DeskCandidate | null,
  recovery: Nudge | null,
  challenge: Nudge | null,
  spotCheck: Nudge | null
): Nudge[] {
  const out: Nudge[] = [];
  if (challenge) out.push(challenge);

  const highStress = stressIsHigh(ctx) || ctx.overloaded;
  const highUrgency = Boolean(desk && desk.nudge.score >= URGENCY_HIGH);

  if (highStress && highUrgency && recovery && desk) {
    const short = Math.max(5, Math.min(SHORT_DESK_MINUTES, usableMinutes(ctx)));
    out.push({
      ...recovery,
      // A distinct id: this is a different offer from the plain pause, and it
      // must carry its own cooldown rather than inherit one.
      id: `recovery:before-focus:${ctx.date}`,
      score: Math.max(recovery.score, desk.nudge.score) + 0.05,
      title: 'Before you dig in',
      body: `${desk.task.title} is ${dayLabel(desk.task.scheduled_date, ctx.now)} and your stress is running high. Five minutes down first, then one short block — that usually goes better than starting cold.`,
      evidence: `${desk.task.title} · stress high · ${usableMinutes(ctx)} min free now`,
      action: { label: 'Take five', href: '/recovery' },
      secondaryAction: {
        label: `Skip to ${short} min focus`,
        href: '/desk',
        params: {
          minutes: String(short),
          taskId: desk.task.id,
          taskTitle: desk.task.title,
          category: desk.category,
        },
      },
    });
  } else {
    // Below the baseline gate a focus nudge points at a half-working feature,
    // so the spot check takes its place rather than joining it.
    if (spotCheck) out.push(spotCheck);
    else if (desk) out.push(desk.nudge);
    if (recovery) out.push(recovery);
  }

  return out.sort((a, b) => b.score - a.score);
}

/* ── The entry point ────────────────────────────────────────────── */

export interface NudgeDecision {
  nudge: Nudge | null;
  /** Why nothing was emitted. For a debug view — never shown to the user. */
  reason: string;
  /** Everything that was considered, best first. */
  considered: Nudge[];
}

/**
 * Decide whether to say anything right now.
 *
 * Called on app foreground and on screen focus — not on a timer. A timer would
 * mean choosing a moment to interrupt someone who is not looking at the app,
 * which is what a push notification is, and this deliberately is not one yet.
 *
 * Emitting a nudge records it as shown, which starts its cooldown. So call this
 * when you are actually going to display the result, not to preview it.
 */
export async function evaluateNudge(now = new Date()): Promise<NudgeDecision> {
  const events = await listNudgeEvents(300);
  const gates = evaluateGates(events, now);

  // Checked before the context is built, not after. The global gates need only
  // the local ledger, while buildContext runs half a dozen queries across
  // tasks, scans, capacity and challenges — and the commonest outcome by far
  // is "already said something today", which does not deserve any of them.
  if (!gates.allowed) return { nudge: null, reason: gates.reason, considered: [] };

  const ctx = await buildContext(now);
  const considered = arbitrate(
    ctx,
    deskCandidate(ctx),
    recoveryCandidate(ctx),
    challengeCandidate(ctx),
    spotCheckCandidate(ctx)
  );

  const eligible = considered.filter(
    (n) =>
      n.score >= MIN_SCORE &&
      !gates.suppressedIds.has(n.id) &&
      !gates.suppressedKinds.has(n.kind) &&
      new Date(n.expiresAt).getTime() > now.getTime()
  );

  if (eligible.length === 0) {
    return {
      nudge: null,
      reason: considered.length === 0 ? 'no candidates' : 'all candidates gated or too weak',
      considered,
    };
  }

  const nudge = eligible[0];
  await recordEvent(nudge, 'shown');
  return { nudge, reason: 'shown', considered };
}
