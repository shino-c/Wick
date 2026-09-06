export interface Baseline {
  rmssdBaseline: number | null;
  scanCount: number;
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
  isMe: boolean;
}

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
  joinedCount: number;
  completedCount: number;
  circleSize: number;
  joined: boolean;
  completedByMe: boolean;
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
}
