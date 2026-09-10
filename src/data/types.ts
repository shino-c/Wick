export interface Baseline {
  rmssdBaseline: number | null;
  /** Every scan ever recorded, finger and face. Display only. */
  scanCount: number;
  /**
   * Finger spot checks only — the scans the RMSSD baseline is actually built
   * from, and the count the "3 scans to unlock" gate reads.
   *
   * These are separate because they must be. A baseline is a *resting*
   * reference; Desk Mode readings are taken mid-task, by definition while the
   * user is working. Folding them into the same moving average dragged the
   * baseline down toward whatever the user's stressed HRV happened to be, which
   * shrank every subsequent deviation toward zero — the app quietly learned to
   * stop detecting stress the more it was used.
   */
  calibrationScans: number;
  perceivedStressBaseline: number | null;
  updatedAt: string;
}

export interface PpgScan {
  id: string;
  source: 'finger' | 'face';
  heartRate: number | null;
  hrvRmssd: number | null;
  stressLevel: string | null;
  deviationPct: number | null;
  signalQuality: 'good' | 'poor';
  createdAt: string;
}

export interface SelfReport {
  id: string;
  score: number;
  rawAnswers: Record<string, number> | null;
  createdAt: string;
}

export interface StressScoreRow {
  id: string;
  fusedScore: number;
  confidence: 'Low' | 'Medium' | 'High';
  signalsUsed: number;
  biometricScore: number | null;
  selfReportScore: number | null;
  loadScore: number | null;
  createdAt: string;
}

export interface FocusSessionRow {
  id: string;
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  actualMinutes: number;
  breaksTaken: number;
  enforcedBreaks: number;
  stressDeltaPct: number | null;
  soundscape: string | null;
  createdAt: string;
}

/** Post-session "did that read feel accurate?" answer. */
export type AccuracyVerdict = 'spot_on' | 'slightly_off' | 'way_off';

export interface CalibrationFeedbackRow {
  id: string;
  sessionId: string | null;
  scanId: string | null;
  verdict: AccuracyVerdict;
  createdAt: string;
}

export interface FriendSummary {
  friendId: string;
  username: string;
}

export interface IncomingRequest {
  id: string;
  requesterId: string;
  username: string;
}

export interface CircleSummary {
  totalFriends: number;
  redZoneCount: number | null;
  avgCapacity: number | null;
  /** True when the circle is too small to aggregate without re-identifying someone. */
  suppressed: boolean;
}

export type ChallengeCategory = 'physical' | 'social' | 'mental';

/**
 * 'meetup' — same place, same time. You need to know who is coming, and
 *            "completed" means you actually turned up.
 * 'solo'   — same window, your own space ("screen-free tea at 4"). Nobody
 *            gathers; each person completes it independently.
 *
 * These were conflated at first, which is why a lakeside walk and a tea break
 * shared one model that suited neither.
 */
export type ChallengeKind = 'meetup' | 'solo';

/** A circle member who joined. Names are shown — joining is a social act, not a stress signal. */
export interface Participant {
  userId: string;
  username: string;
  completed: boolean;
  /** True when a measurement witnessed the completion, not just a tap. */
  verified: boolean;
  isMe: boolean;
}

/**
 * How a challenge can prove it was done.
 *
 * 'breathing'  — finish a guided breathing session. Wick reads the HRV change
 *                from the finger sensor, so "I did it" carries evidence.
 * 'spot_check' — take a finger spot check. Proves you stopped and sat still.
 * null         — nothing measurable. Four friends walking round a lake is not
 *                something a phone camera can witness, and a proxy for it would
 *                be worse than trusting them.
 */
export type ChallengeVerification = 'breathing' | 'spot_check' | null;

export interface ChallengeRow {
  id: string;
  title: string;
  subtitle: string;
  scheduledFor: string | null;
  category: ChallengeCategory;
  kind: ChallengeKind;
  /** Where to meet. Meetups only. */
  location: string | null;
  /** Max people, null for unlimited. */
  capacity: number | null;
  verifyWith: ChallengeVerification;
  /** Called off by its creator. Stays visible and in everyone's history. */
  cancelled: boolean;
  /** Set once the creator edits a challenge other people had already joined. */
  updatedAt: string | null;
  joinedCount: number;
  completedCount: number;
  circleSize: number;
  joined: boolean;
  completedByMe: boolean;
  /** Whether YOUR completion was witnessed by a measurement. */
  verifiedByMe: boolean;
  /** Null for the seeded challenges; set for anything a member created. */
  createdBy: string | null;
  createdByMe: boolean;
  notes: string | null;
  participants: Participant[];
}

export interface NewChallenge {
  title: string;
  subtitle: string;
  scheduledFor: string | null;
  category: ChallengeCategory;
  kind: ChallengeKind;
  location: string | null;
  capacity: number | null;
  notes: string | null;
  verifyWith: ChallengeVerification;
}

/**
 * A word of support that arrived from your circle.
 *
 * There is no sender field, on purpose and in both directions: the sender is
 * never told who is struggling, and the recipient is never told who reached
 * out. What survives is that somebody did.
 */
export interface SupportNudge {
  id: string;
  body: string;
  createdAt: string;
  seenAt: string | null;
}

/* ── Calendar & Workload Types ─────────────────────────────────────────── */

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

export type CalendarEvent = CalendarEventItem;

export type TaskCategory =
  | 'academic'
  | 'work'
  | 'social'
  | 'physical'
  | 'mental'
  | 'errands'
  | 'other';

export type TaskPriority = 'high' | 'medium' | 'low';

export interface TaskAnalysis {
  id: string;
  title: string;
  category: string;
  priority: TaskPriority;
  estimated_duration_hours: number;
  scheduled_date: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  capacity_hours?: number;
  rank: number;
  ai_reasoning?: string;
  stress_score?: number;
  status: 'pending' | 'approved' | 'rejected' | 'scheduled' | 'completed' | 'deferred';
  calendar_event_id?: string;
  calendar_provider?: 'device' | 'google' | 'outlook' | string;
  week_start?: string;
  createdAt?: string;
}

export interface WorkloadItem {
  id: string;
  title: string;
  category: string;
  priority: TaskPriority;
  estimated_hours: number;
  scheduled_start?: string;
  scheduled_end?: string;
  status: string;
  calendar_event_id?: string;
  source?: string;
  createdAt?: string;
}

export interface WeeklyCapacityAnalysis {
  id?: string;
  week_start: string;
  total_capacity_hours: number;
  used_capacity_hours: number;
  overload_warning: boolean;
  category_breakdown: Record<string, number>;
  stress_score: number;
  ai_reasoning?: string;
  createdAt?: string;
}

export interface LoadBalanceSuggestion {
  taskId: string;
  taskTitle: string;
  reason: string;
  suggestedDate?: string;
  hoursSaved: number;
}

/* ── Pillar 5: recovery & garden ─────────────────────────────────── */

/** One day of recovery activity, keyed by ISO date. */
export interface RecoveryDay {
  date: string;
  completedPlanIds: string[];
  gameCompleted?: boolean;
  gameMinutes?: number;
  outdoorCompleted?: boolean;
  recoveryEventId?: string | null;
  recoveryEventStart?: string | null;
  recoveryPct?: number;
  updatedAt?: string;
}

/** A real gap in today's schedule, as "HH:MM" label + minutes of freedom. */
export interface AvailableSlot {
  start: string;
  end: string;
  minutes: number;
}

/** One gentle, optional recovery suggestion matched to a free slot. */
export interface RecoverySuggestion {
  id: string;
  emoji: string;
  title: string;
  detail: string;
  minutes: number;
  reason: string;
  slot?: AvailableSlot;
  /**
   * How "done" is actually measured. A plan is never finished by tapping a
   * button — `steps` is met by the pedometer, `minutes` by a real timer.
   */
  targetType: 'steps' | 'minutes';
  /** The real target: number of steps, or number of minutes. */
  targetValue: number;
}

/**
 * A started recovery plan. Persisted so progress and completion survive
 * reloads and reflect real tracking, never a guessed "done".
 */
export interface RecoveryPlanSession {
  id: string;
  /** The recovery day the plan belongs to (ISO date). */
  date: string;
  /** The plan / suggestion id this session belongs to. */
  planKey: string;
  title: string;
  emoji: string;
  detail?: string | null;
  targetType: 'steps' | 'minutes' | 'none';
  targetValue: number;
  /** Current measured progress: steps taken, or minutes elapsed. */
  progressValue: number;
  status: 'started' | 'completed';
  startedAt: string;
  completedAt?: string | null;
  /** Whether the one-time seed reward was already granted for this session. */
  rewardAwarded?: boolean;
  createdAt: string;
}

/** The day's plan: free time plus a few gentle optional suggestions. */
export interface DailyRecoveryPlan {
  date: string;
  slots: AvailableSlot[];
  suggestions: RecoverySuggestion[];
  note: string;
}

/** Seed balance held by the user to grow their garden. */
export interface GardenWallet {
  seeds: number;
  updatedAt?: string;
}

/** A purchasable garden object (static catalogue entry). */
export interface GardenCatalogItem {
  key: string;
  name: string;
  emoji: string;
  kind: 'plant' | 'flower' | 'pet' | 'decoration';
  seeds: number;
}

/** An item the user owns, persisted in the garden. */
export interface GardenItem {
  id: string;
  itemKey: string;
  name: string;
  emoji: string;
  kind: 'plant' | 'flower' | 'pet' | 'decoration';
  placedAt?: string;
}

