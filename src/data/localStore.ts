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
    CalendarConnection,
    CalibrationFeedbackRow,
    ChallengeRow,
    FocusSessionRow,
    FriendSummary,
    IncomingRequest,
    PpgScan,
    RecoveryDay,
    SelfReport,
    StressScoreRow,
    SupportNudge,
    WorkloadItem,
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
  workloadItems: WorkloadItem[];
  calendarConnections: CalendarConnection[];
  recoveryDays: RecoveryDay[];
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
    workloadItems: [],
    calendarConnections: [],
    recoveryDays: [],
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
      cancelled: false,
      updatedAt: null,
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
      cancelled: false,
      updatedAt: null,
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
      cancelled: false,
      updatedAt: null,
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

export function getMondayOfWeek(d: Date = new Date()): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function getLocalDateKey(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function seedCalendarItems(provider: 'google' | 'outlook'): WorkloadItem[] {
  const monday = getMondayOfWeek();
  const makeDate = (dayOffset: number, hour: number) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  if (provider === 'google') {
    return [
      {
        id: `g-${uid()}`,
        title: 'Thesis & Lab prep',
        category: 'academic',
        estimatedHours: 4.0,
        priority: 'high',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(0, 9),
        scheduledEnd: makeDate(0, 13),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Mindful Breathing Session',
        category: 'mental',
        estimatedHours: 1.0,
        priority: 'high',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(0, 20),
        scheduledEnd: makeDate(0, 21),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Algorithms Lecture & Problem Set',
        category: 'academic',
        estimatedHours: 4.0,
        priority: 'high',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(1, 10),
        scheduledEnd: makeDate(1, 14),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Coffee & Birthdays',
        category: 'social',
        estimatedHours: 3.0,
        priority: 'medium',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(1, 16),
        scheduledEnd: makeDate(1, 19),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Screen-Free Evening Reading',
        category: 'mental',
        estimatedHours: 1.0,
        priority: 'medium',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(1, 21),
        scheduledEnd: makeDate(1, 22),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Morning Run & Stretching',
        category: 'physical',
        estimatedHours: 2.5,
        priority: 'medium',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(2, 7),
        scheduledEnd: makeDate(2, 9),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Machine Learning Seminar',
        category: 'academic',
        estimatedHours: 3.0,
        priority: 'medium',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(2, 14),
        scheduledEnd: makeDate(2, 17),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Deep Clean Kitchen',
        category: 'errands',
        estimatedHours: 2.5,
        priority: 'medium',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(2, 19),
        scheduledEnd: makeDate(2, 21),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Gym & Core Workout',
        category: 'physical',
        estimatedHours: 3.0,
        priority: 'medium',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(3, 8),
        scheduledEnd: makeDate(3, 11),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Organize Desk Files',
        category: 'academic',
        estimatedHours: 2.0,
        priority: 'low',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(3, 16),
        scheduledEnd: makeDate(3, 18),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Dinner with Study Circle',
        category: 'social',
        estimatedHours: 4.5,
        priority: 'medium',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(4, 18),
        scheduledEnd: makeDate(4, 22),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Weekly Grocery Shopping',
        category: 'errands',
        estimatedHours: 2.0,
        priority: 'medium',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(5, 11),
        scheduledEnd: makeDate(5, 13),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Laundry & Room Reset',
        category: 'errands',
        estimatedHours: 2.0,
        priority: 'low',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(5, 14),
        scheduledEnd: makeDate(5, 16),
        createdAt: new Date().toISOString(),
      },
      {
        id: `g-${uid()}`,
        title: 'Sunday Downtime Walk',
        category: 'mental',
        estimatedHours: 1.5,
        priority: 'medium',
        source: 'google',
        status: 'scheduled',
        scheduledStart: makeDate(6, 15),
        scheduledEnd: makeDate(6, 16),
        createdAt: new Date().toISOString(),
      },
    ];
  }

  return [
    {
      id: `o-${uid()}`,
      title: 'Operating Systems Capstone',
      category: 'academic',
      estimatedHours: 4.5,
      priority: 'high',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(0, 9),
      scheduledEnd: makeDate(0, 13),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Faculty Consultation & Lab Prep',
      category: 'academic',
      estimatedHours: 4.0,
      priority: 'high',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(1, 11),
      scheduledEnd: makeDate(1, 15),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Distributed Systems Lecture',
      category: 'academic',
      estimatedHours: 3.0,
      priority: 'medium',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(2, 13),
      scheduledEnd: makeDate(2, 16),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Organize Desk Files',
      category: 'academic',
      estimatedHours: 2.0,
      priority: 'low',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(3, 17),
      scheduledEnd: makeDate(3, 19),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Coffee & Catchup with Teammates',
      category: 'social',
      estimatedHours: 3.0,
      priority: 'medium',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(1, 16),
      scheduledEnd: makeDate(1, 19),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Club Social Mixer',
      category: 'social',
      estimatedHours: 4.5,
      priority: 'medium',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(5, 18),
      scheduledEnd: makeDate(5, 22),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Campus Run & Warm-up',
      category: 'physical',
      estimatedHours: 2.5,
      priority: 'medium',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(1, 7),
      scheduledEnd: makeDate(1, 9),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Gym & Cardio',
      category: 'physical',
      estimatedHours: 3.0,
      priority: 'medium',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(3, 8),
      scheduledEnd: makeDate(3, 11),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Deep Clean Kitchen',
      category: 'errands',
      estimatedHours: 2.5,
      priority: 'medium',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(2, 19),
      scheduledEnd: makeDate(2, 21),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Weekly Supplies & Groceries',
      category: 'errands',
      estimatedHours: 2.0,
      priority: 'medium',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(4, 12),
      scheduledEnd: makeDate(4, 14),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Laundry & Dorm Organization',
      category: 'errands',
      estimatedHours: 2.0,
      priority: 'low',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(6, 11),
      scheduledEnd: makeDate(6, 13),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Breathing Break & Meditation',
      category: 'mental',
      estimatedHours: 1.5,
      priority: 'high',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(0, 20),
      scheduledEnd: makeDate(0, 21),
      createdAt: new Date().toISOString(),
    },
    {
      id: `o-${uid()}`,
      title: 'Evening Quiet Downtime',
      category: 'mental',
      estimatedHours: 1.5,
      priority: 'medium',
      source: 'outlook',
      status: 'scheduled',
      scheduledStart: makeDate(3, 21),
      scheduledEnd: makeDate(3, 22),
      createdAt: new Date().toISOString(),
    },
  ];
}
