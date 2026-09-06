/**
 * Offline demo store.
 *
 * Wick is fully usable without a Supabase project configured: every repository
 * call falls back here. That keeps UI work unblocked, keeps the demo alive if
 * the venue wifi dies, and means a fresh clone runs with zero setup.
 *
 * Everything lives in AsyncStorage on the device — same privacy posture as the
 * real backend, and still no raw frames or waveforms anywhere.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Baseline,
  CalibrationFeedbackRow,
  ChallengeRow,
  FocusSessionRow,
  FriendSummary,
  IncomingRequest,
  PpgScan,
  SelfReport,
  StressScoreRow,
  SupportNudge,
} from './types';

const KEY = 'wick.local.v1';

export interface LocalDb {
  onboarded: boolean;
  inviteCode: string;
  username: string;
  baseline: Baseline;
  scans: PpgScan[];
  selfReports: SelfReport[];
  stressScores: StressScoreRow[];
  sessions: FocusSessionRow[];
  feedback: CalibrationFeedbackRow[];
  friends: FriendSummary[];
  requests: IncomingRequest[];
  challenges: ChallengeRow[];
  nudges: SupportNudge[];
}

export const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function emptyDb(): LocalDb {
  return {
    onboarded: false,
    inviteCode: `WICK-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    username: 'you',
    baseline: {
      rmssdBaseline: null,
      scanCount: 0,
      calibrationScans: 0,
      perceivedStressBaseline: null,
      updatedAt: new Date().toISOString(),
    },
    scans: [],
    selfReports: [],
    stressScores: [],
    sessions: [],
    feedback: [],
    friends: [],
    requests: [],
    challenges: seedChallenges(),
    nudges: [],
  };
}

/** Shared recovery challenges. Static in v1 — join state is what's real. */
function seedChallenges(): ChallengeRow[] {
  return [
    {
      id: 'walk-lakeside',
      title: 'Group Walk: Lakeside',
      subtitle: 'Active recovery · 30 min',
      scheduledFor: 'Tomorrow, 6:00 PM',
      category: 'physical',
      kind: 'meetup',
      location: 'Lakeside path, main entrance',
      capacity: 6,
      verifyWith: null,
      joinedCount: 0,
      completedCount: 0,
      circleSize: 1,
      joined: false,
      completedByMe: false,
      verifiedByMe: false,
      createdBy: null,
      createdByMe: false,
      notes:
        'Gentle loop of the lake. No pace, no tracking — just moving somewhere that is not your desk.',
      participants: [],
    },
    {
      id: 'tea-break',
      title: 'Screen-Free Tea Break',
      subtitle: 'Mental downtime · 15 min',
      scheduledFor: 'Today, 4:00 PM',
      category: 'mental',
      kind: 'solo',
      location: null,
      capacity: null,
      // A tea break is a recovery break, and a recovery break is exactly the
      // thing Wick can actually witness.
      verifyWith: 'breathing',
      joinedCount: 0,
      completedCount: 0,
      circleSize: 1,
      joined: false,
      completedByMe: false,
      verifiedByMe: false,
      createdBy: null,
      createdByMe: false,
      notes: 'Fifteen minutes, no screens, wherever you are. Phones face-down.',
      participants: [],
    },
    {
      id: 'reach-out',
      title: 'Reach Out to Someone',
      subtitle: 'Social recovery · one message',
      scheduledFor: null,
      category: 'social',
      kind: 'solo',
      location: null,
      capacity: null,
      verifyWith: null,
      joinedCount: 0,
      completedCount: 0,
      circleSize: 1,
      joined: false,
      completedByMe: false,
      verifiedByMe: false,
      createdBy: null,
      createdByMe: false,
      notes: 'Message one person you have not spoken to this week. That is the whole challenge.',
      participants: [],
    },
  ];
}

let cache: LocalDb | null = null;

export async function readDb(): Promise<LocalDb> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(KEY);
  cache = raw ? { ...emptyDb(), ...(JSON.parse(raw) as LocalDb) } : emptyDb();
  return cache;
}

export async function writeDb(mutate: (db: LocalDb) => void): Promise<LocalDb> {
  const db = await readDb();
  mutate(db);
  cache = db;
  await AsyncStorage.setItem(KEY, JSON.stringify(db));
  return db;
}

export async function resetDb(): Promise<void> {
  cache = emptyDb();
  await AsyncStorage.setItem(KEY, JSON.stringify(cache));
}
