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

export interface ChallengeRow {
  id: string;
  title: string;
  subtitle: string;
  scheduledFor: string | null;
  category: ChallengeCategory;
  joinedCount: number;
  circleSize: number;
  joined: boolean;
  /** Null for the seeded challenges; set for anything a member created. */
  createdBy: string | null;
  createdByMe: boolean;
  notes: string | null;
}

export interface NewChallenge {
  title: string;
  subtitle: string;
  scheduledFor: string | null;
  category: ChallengeCategory;
  notes: string | null;
}
