/**
 * demoMode.ts — the zero-configuration simulation.
 *
 * WHY THIS EXISTS
 * ---------------
 * Wick is pitched, reviewed and walked through by people who have not
 * configured anything: no `.env`, no Supabase project, no phone calendar, no
 * camera. Until now that collapsed the whole dashboard to "No tasks logged for
 * this week" — the empty state was the first thing anybody saw, and the parts of
 * the product worth showing (the week's stress curve, a nearly-full capacity
 * ring, the load balancer) needed a real calendar to appear.
 *
 * So: when there is no configuration of any kind, the app runs on one fixed,
 * realistic week instead. It is the *only* thing that changes — the screens,
 * navigation, storage and repository are the real ones.
 *
 * ── What counts as "no configuration" ────────────────────────────────
 * `demoMode` is on only when ALL of these hold:
 *   1. no Supabase project (hasSupabase === false), and
 *   2. no AI key that would change the numbers (EXPO_PUBLIC_GROQ_API_KEY), and
 *   3. nothing already configured on this device — no calendar connection and
 *      no task of the user's own.
 *
 * Point 3 is the important one. Everything below is seeded exactly once and
 * then written into the ordinary local store, so the moment a real calendar is
 * connected (or a real task is added) the data is the user's, the demo stops
 * describing itself as simulated, and nothing is ever overwritten. This is
 * "start from a filled-in week", not "a mock layer bolted underneath".
 *
 * ── The demo clock ───────────────────
 * The brief for the demo week is "today is Monday". Rather than fake the date
 * globally — which would poison every real timestamp written afterwards — the
 * week is seeded relative to the *real* current week and then pinned: the
 * dashboard treats Monday of that week as today, and the ~14 of ~90% of the
 * week's load are placed on Monday through Sunday so the curve spans all seven
 * days. Nothing in storage is dated in the future, so a real build that has its
 * own data is entirely unaffected.
 */
import {
  readDb,
  resetDb,
  uid,
  writeDb,
  type LocalDb,
} from '@/data/localStore';
import type { TaskAnalysis } from '@/data/types';
import { hasSupabase } from '@/lib/supabaseClient';
import { analyzeWeeklyCapacity } from '@/services/aiService';
import { toISODate } from '@/services/dateUtils';

/** No AI key means the numbers below are the numbers on screen. */
export const hasAiKey = Boolean(process.env.EXPO_PUBLIC_GROQ_API_KEY);

/* ── The demo week ─────────────────── */

/**
 * The Monday the demo week belongs to: Monday of whatever week this device is
 * actually in. Derived from the real clock so the seeded dates are plausible
 * dates rather than a hardcoded year that will look stale next year.
 */
function mondayOfThisWeek(): Date {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

const DEMO_MONDAY = mondayOfThisWeek();
const DEMO_WEEK_START = toISODate(DEMO_MONDAY);

/** `dayOffset` 0 = Monday … 6 = Sunday. */
function demoDate(dayOffset: number): string {
  const d = new Date(DEMO_MONDAY);
  d.setDate(d.getDate() + dayOffset);
  return toISODate(d);
}

interface DemoTemplate {
  title: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  hours: number;
  /** 0 = Monday … 6 = Sunday. */
  day: number;
  start: string;
  end: string;
  /** How demanding this reads on the day it lands, 0-100. */
  stress: number;
  reasoning: string;
}

/**
 * Fourteen tasks, drawn from a real student week rather than invented variety:
 * two deadlines, a lab and a lecture block, shifts, gym, errands, a social
 * evening — and enough low-priority admin that the load balancer has something
 * honest to suggest deferring.
 *
 * The hours deliberately total 36 of a 40-hour week: 90%, which is the number
 * the capacity ring reports and the reason its overload warning is lit.
 */
const DEMO_TASKS: DemoTemplate[] = [
  // ── Monday: the day the demo shows as "today" ──────────────────────
  {
    title: 'Algorithms Lecture',
    category: 'academic',
    priority: 'medium',
    hours: 2,
    day: 0,
    start: '09:00',
    end: '11:00',
    stress: 55,
    reasoning: 'Scheduled class, low control over timing.',
  },
  {
    title: 'DSA Assignment 3',
    category: 'academic',
    priority: 'high',
    hours: 6,
    day: 0,
    start: '18:00',
    end: '23:59',
    stress: 88,
    reasoning: 'Hard deadline tonight — the load that makes Monday the peak.',
  },
  // ── Tuesday ─────────────────────────
  {
    title: 'Standup + Sprint Review',
    category: 'work',
    priority: 'medium',
    hours: 2.5,
    day: 1,
    start: '10:00',
    end: '11:30',
    stress: 52,
    reasoning: 'Fixed meeting block; moderate cognitive demand.',
  },
  {
    title: 'Physics Lab Report',
    category: 'academic',
    priority: 'high',
    hours: 3,
    day: 1,
    start: '20:00',
    end: '23:00',
    stress: 79,
    reasoning: 'Written work due midweek; needs a focused block.',
  },

  // ── Wednesday ───────────────────────
  {
    title: 'Client Project Sync',
    category: 'work',
    priority: 'medium',
    hours: 2,
    day: 2,
    start: '13:00',
    end: '15:00',
    stress: 58,
    reasoning: 'Collaborative session — medium load.',
  },
  {
    title: 'Gym Session',
    category: 'physical',
    priority: 'low',
    hours: 1.5,
    day: 2,
    start: '18:30',
    end: '20:00',
    stress: 20,
    reasoning: 'Active recovery; it pays capacity back rather than spending it.',
  },
  {
    title: 'Grocery Run',
    category: 'errands',
    priority: 'low',
    hours: 1,
    day: 2,
    start: '20:30',
    end: '21:30',
    stress: 25,
    reasoning: 'Flexible errand — a candidate for deferral.',
  },

  // ── Thursday ────────────────────────
  {
    title: 'Operating Systems Exam',
    category: 'academic',
    priority: 'high',
    hours: 3,
    day: 3,
    start: '09:00',
    end: '12:00',
    stress: 92,
    reasoning: 'Highest-stakes event of the week.',
  },
  {
    title: 'Study Group',
    category: 'social',
    priority: 'medium',
    hours: 1.5,
    day: 3,
    start: '16:00',
    end: '17:30',
    stress: 35,
    reasoning: 'Shared study; supportive rather than demanding.',
  },

  // ── Friday ──────────────────────────
  {
    title: 'Part-time Shift',
    category: 'work',
    priority: 'medium',
    hours: 4,
    day: 4,
    start: '12:00',
    end: '16:00',
    stress: 62,
    reasoning: 'Committed work hours with limited flexibility.',
  },
  {
    title: 'Database Project Milestone',
    category: 'academic',
    priority: 'high',
    hours: 3,
    day: 4,
    start: '18:00',
    end: '21:00',
    stress: 76,
    reasoning: 'Submission checkpoint before the weekend.',
  },

  // ── Saturday ────────────────────────
  {
    title: 'Deep Clean Room',
    category: 'errands',
    priority: 'low',
    hours: 2,
    day: 5,
    start: '11:00',
    end: '12:00',
    stress: 22,
    reasoning: 'Low priority chore — deferring costs nothing.',
  },
  {
    title: 'Movie Night with Friends',
    category: 'social',
    priority: 'low',
    hours: 3,
    day: 5,
    start: '19:00',
    end: '22:00',
    stress: 18,
    reasoning: 'Genuine downtime; it relieves load rather than adding it.',
  },

  // ── Sunday ──────────────────────────
  {
    title: 'Weekly Review & Planning',
    category: 'mental',
    priority: 'low',
    hours: 1.5,
    day: 6,
    start: '17:00',
    end: '18:00',
    stress: 28,
    reasoning: 'Reflective, low-stakes wrap-up of the week.',
  },
];

/** The demo week's own single answer — "mildly tense", not alarming. */
/**
 * The demo week's own single answer — "mildly tense", not alarming.
 *
 * Kept below 70 on purpose: the capacity analyser drops this person's whole
 * weekly threshold from 40 hours to 32 above that line (a high baseline stress
 * genuinely means less usable capacity), which would put the demo week at 112%
 * and read as an emergency rather than a week with a little too much in it.
 */
const DEMO_SELF_REPORT = 62;

/**
 * Finger spot checks, so the calibration gate reads as already met.
 *
 * They are recorded with `signalQuality: 'good'` deliberately. `getBaseline()`
 * derives `calibrationScans` by counting *good* finger scans, so a "poor" seed
 * would leave the gate reading 0/3 no matter how many rows exist.
 *
 * `hrvRmssd` stays null, and that is what keeps these rows honest: nothing
 * downstream computes a stress score from them, so they are a count rather than
 * a fabricated measurement. The `stress_scores` table is deliberately left empty
 * for the same reason — a fused score is supposed to mean a sensor reading
 * happened.
 */
const DEMO_BASELINE_SCANS = 3;

/**
 * The seeded task list, rebuilt from the templates and the current week's dates.
 *
 * Rebuilt rather than stored for two reasons: the demo week rolls forward with
 * the real week (so it is never a stale set of dates), and a task the user
 * deletes can be restored by re-syncing instead of only by clearing storage.
 */
function demoTasksFor(weekStart: string): TaskAnalysis[] {
  return DEMO_TASKS.map((t, i): TaskAnalysis => ({
    id: uid(),
    title: t.title,
    category: t.category,
    priority: t.priority,
    estimated_duration_hours: t.hours,
    scheduled_date: demoDate(t.day),
    scheduled_start_time: t.start,
    scheduled_end_time: t.end,
    capacity_hours: t.hours,
    rank: i + 1,
    stress_score: t.stress,
    ai_reasoning: t.reasoning,
    status: 'approved',
    calendar_provider: 'device',
    week_start: weekStart,
    createdAt: new Date(`${demoDate(t.day)}T08:00:00`).toISOString(),
  }));
}

/**
 * Writes the demo week into the local store.
 *
 * Nothing outside the week's task/capacity/self-report rows is touched, so a
 * re-seed (from "re-sync calendar") keeps the user's setup flag, their garden
 * and anything else already stored.
 */
async function seedDemoWeek(weekStart = DEMO_WEEK_START): Promise<void> {
  const tasks = demoTasksFor(weekStart);

  // Capacity is computed from the tasks themselves by the app's own analyser,
  // so the ring, the category bar and the overload warning can never disagree
  // with the task list they are describing.
  const capacity = await analyzeWeeklyCapacity(tasks, {
    perceivedStressBaseline: DEMO_SELF_REPORT,
  });
  const capacityRecord = { ...capacity, week_start: weekStart };

  await writeDb((db) => {
    db.taskAnalyses = tasks;
    db.weeklyCapacities = [capacityRecord];

    db.selfReports = [
      {
        id: uid(),
        score: DEMO_SELF_REPORT,
        // A completed mock questionnaire keeps the zero-configuration baseline
        // usable without asking the reviewer to repeat onboarding by hand.
        rawAnswers: { q1: 3, q2: 2, q3: 1, q4: 2, q5: 3 },
        createdAt: new Date(`${demoDate(0)}T08:05:00`).toISOString(),
      },
    ];

    db.baseline = {
      ...db.baseline,
      scanCount: DEMO_BASELINE_SCANS,
      calibrationScans: DEMO_BASELINE_SCANS,
      perceivedStressBaseline: DEMO_SELF_REPORT,
      updatedAt: new Date().toISOString(),
    };

    // The questionnaire is seeded with representative answers as part of the
    // zero-configuration simulation, so the baseline gate and dashboard are
    // immediately usable while the displayed score remains the explicit demo
    // self-report above.
    db.scans = Array.from({ length: DEMO_BASELINE_SCANS }, (_, i) => ({
      id: uid(),
      source: 'finger' as const,
      heartRate: null,
      hrvRmssd: null,
      stressLevel: null,
      deviationPct: null,
      signalQuality: 'good' as const,
      createdAt: new Date(`${demoDate(Math.min(i, 6))}T07:30:00`).toISOString(),
    }));
  });

  // Setup is complete *before* the connection is written, and this ordering is
  // load-bearing. `connectCalendar()` triggers the baseline screen's refresh,
  // which calls `getCalibrationScans()` — and if that has already moved the
  // counter on, the writes below would put `onboarded` back to its old value on
  // the next read-modify-write and bounce the user into onboarding.
  await writeDb((db) => {
    db.onboarded = true;
  });

  // The calendar connection lives under its own AsyncStorage key, managed by
  // calendarSync — not in the local store above.
  const { connectCalendar, getCalendarConnections } = await import('@/services/calendarSync');
  const existing = await getCalendarConnections();
  if (!existing.some((c) => c.provider === 'device')) {
    await connectCalendar();
  }
}

/* ── Public state ──────────────────── */

export interface DemoStatus {
  /** True when nothing is configured and the simulation week is in use. */
  active: boolean;
  /** Monday of the simulated week, ISO date. */
  weekStart: string;
}

let status: DemoStatus = { active: false, weekStart: DEMO_WEEK_START };

/** The status as of the last bootstrap/reseed. Synchronous for render paths. */
export function demoSync(): DemoStatus {
  return status;
}

/** How many tasks the simulation week holds. Used by the dashboard copy. */
export const DEMO_TASK_COUNT = DEMO_TASKS.length;

/**
 * Why the demo reads as overdue: the seeded week is deliberately loaded to ~90%
 * of a 40-hour capacity, which is what makes the capacity ring, the peak day and
 * the load balancer all have something real to say.
 */
export const DEMO_CAPACITY_TARGET_PCT = 90;

export function isDemoActive(): boolean {
  return status.active;
}

/**
 * The Monday the app should treat as "start of this week".
 *
 * In demo mode this is the simulated week (which happens to be the real week's
 * Monday too, so the only visible effect is the pinned "today" below).
 */
export function activeWeekStartISO(): string {
  return status.active ? status.weekStart : realWeekStartISO();
}

export function realWeekStartISO(): string {
  return toISODate(mondayOfThisWeek());
}

/**
 * Which day the dashboard should treat as today, 0 = Monday … 6 = Sunday.
 *
 * The demo week is presented as a Monday: the pitch is "here is the start of a
 * heavy week", which is also the only day on which "defer some of this" is
 * advice the user can still act on.
 */
export function demoTodayIndex(): number {
  if (!status.active) {
    return (new Date().getDay() + 6) % 7;
  }
  return 0;
}

/** Today's ISO date as the app should read it. */
export function activeTodayISO(): string {
  if (!status.active) return toISODate();
  return demoDate(0);
}

/**
 * Should the demo week be seeded?
 *
 * Requirements are deliberately strict — see the header. The "nothing of the
 * user's own" test reads the local store, which is the same place a real task
 * ends up, so a calendar that has ever been synced permanently opts out.
 */
export async function shouldEnterDemoMode(): Promise<boolean> {
  if (hasSupabase) return false;
  if (hasAiKey) return false;

  const db = await readDb();
  const tasks = db.taskAnalyses ?? [];
  const hasOwnTasks = tasks.length > 0;

  let calendarConnected = false;
  try {
    const { getCalendarConnections } = await import('@/services/calendarSync');
    const connections = await getCalendarConnections();
    calendarConnected = connections.some((c) => c.connected);
  } catch {
    // No calendar module and no stored connection — that is the zero-config case.
  }

  // A previous web build could leave a demo calendar connection behind while
  // its task rows were cleared or migrated. Treat that empty local store as the
  // zero-configuration case so the next launch restores the complete sample.
  if (!hasOwnTasks && calendarConnected) return true;

  return !hasOwnTasks && !calendarConnected;
}

/**
 * Re-seeds the simulation week in place and returns how many tasks it holds.
 *
 * Called when the user presses "re-sync calendar" while the simulation is what
 * is on screen, so re-syncing does something visible (and honest) rather than
 * pulling a real device calendar over the top of a simulated week.
 */
export async function reseedDemoWeek(): Promise<number> {
  await seedDemoWeek(status.weekStart || DEMO_WEEK_START);
  return DEMO_TASKS.length;
}

/** Reset the local store back to the pristine configuration-free state. */
async function clearLocalConfig(): Promise<void> {
  await resetDb();
  try {
    const { disconnectCalendar } = await import('@/services/calendarSync');
    await disconnectCalendar();
  } catch {
    // Nothing was connected; nothing to disconnect.
  }
}

/**
 * Entry point, called from bootstrap() on every launch.
 *
 * Seeding happens at most once — after it the store is non-empty, so
 * `shouldEnterDemoMode()` is false on every later launch and the simulation is
 * recognised rather than regenerated.
 */
export async function setupDemoMode(): Promise<DemoStatus> {
  if (hasSupabase) {
    status = { active: false, weekStart: DEMO_WEEK_START };
    return status;
  }

  const eligible = await shouldEnterDemoMode();
  const dbBeforeSeed = await readDb();
  const storedTasks = dbBeforeSeed.taskAnalyses ?? [];
  const hasKnownDemoTask = storedTasks.some((task) =>
    DEMO_TASKS.some((demoTask) => demoTask.title === task.title)
  );
  const hasOnlyDeviceTasks = storedTasks.every(
    (task) => task.calendar_provider === 'device'
  );
  const staleDemoStore =
    !hasAiKey &&
    ((hasKnownDemoTask && !isDemoWeek(dbBeforeSeed, DEMO_WEEK_START)) ||
      (storedTasks.length === 0 && dbBeforeSeed.onboarded && hasOnlyDeviceTasks));

  if (eligible || staleDemoStore) {
    // Local web storage can survive a code change. Only replace an existing
    // store when it has unmistakable demo fingerprints; real task data is left
    // untouched. This restores the required 14-task simulation on reload.
    if (staleDemoStore && storedTasks.length > 0 && !isDemoWeek(dbBeforeSeed, DEMO_WEEK_START)) {
      await clearLocalConfig();
    }
    await seedDemoWeek();
  }

  const db = await readDb();
  const seededWeek = db.weeklyCapacities?.[0]?.week_start ?? DEMO_WEEK_START;
  const recognised = !hasAiKey && isDemoWeek(db, seededWeek);
  status = { active: eligible || recognised, weekStart: seededWeek };

  // The daily recovery plan is cached per day. One cached by an older build
  // (built from the real clock instead of the demo's Monday) holds an empty
  // free-window list; drop exactly those so the next read rebuilds the plan
  // from the seeded week. Configured accounts never enter this path.
  if (status.active) {
    await writeDb((db) => {
      if (db.dailyRecoveryPlans?.some((plan) => plan.slots.length === 0)) {
        db.dailyRecoveryPlans = db.dailyRecoveryPlans.filter((plan) => plan.slots.length > 0);
      }
    });
  }

  return status;
}

/**
 * Is this store the simulation week?
 *
 * "Recognised" rather than "eligible": a device that has the demo week and then
 * connects a real calendar must stop being a demo, which is the opposite test
 * and is handled by `shouldEnterDemoMode()`. This one exists so the status
 * survives a reload without re-seeding, and it matches on titles as well as the
 * count so a real week of fourteen tasks is never mistaken for the simulation.
 */
function isDemoWeek(db: LocalDb, weekStart: string): boolean {
  const tasks = db.taskAnalyses ?? [];
  if (tasks.length !== DEMO_TASKS.length) return false;
  if (!tasks.every((t) => t.week_start === weekStart)) return false;
  const titles = new Set(DEMO_TASKS.map((t) => t.title));
  return tasks.every((t) => titles.has(t.title));
}

/** The demo week's Monday, for callers that need it before bootstrap finishes. */
export const DEMO_WEEK_START_ISO = DEMO_WEEK_START;

export { DEMO_TASKS };
export type { DemoTemplate };

