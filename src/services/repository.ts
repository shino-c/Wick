/**
 * repository.ts — the one place that decides "Supabase or local demo store?".
 *
 * Screens never import supabaseClient or localStore directly; they call these
 * functions. Adding the backend later (or losing it mid-demo) changes nothing
 * above this line.
 */
import { readDb, uid, writeDb } from '@/data/localStore';
import type {
  AccuracyVerdict,
  Baseline,
  CalendarConnection,
  CalendarEventItem,
  ChallengeRow,
  CircleSummary,
  FocusSessionRow,
  FriendSummary,
  GardenItem,
  GardenWallet,
  IncomingRequest,
  NewChallenge,
  Participant,
  PpgScan,
  SelfReport,
  StressScoreRow,
  SupportNudge,
  TaskAnalysis,
  WeeklyCapacityAnalysis,
  WorkloadItem
} from '@/data/types';
import { currentUserId, hasSupabase, supabase } from '@/lib/supabaseClient';
import {
  addEventToDeviceCalendar,
  deleteEventFromDeviceCalendar,
  syncCalendarEvents,
} from '@/services/calendarSync';
import { ageHours, fuseStressScore, type FusionResult } from './fusionService';
import { PPGService, type PPGResult, type StressClassification } from './ppgService';

export { type LoadBalanceSuggestion, type TaskAnalysis, type WeeklyCapacityAnalysis } from '@/data/types';

/**
 * Smallest circle we will aggregate. Below this, "2 of 2 friends are in the red
 * zone" is a raw individual score wearing a disguise, so we suppress instead.
 */
export const MIN_CIRCLE_SIZE = 3;

/**
 * How many recent finger spot checks the RMSSD baseline is built from.
 *
 * It used to be a cumulative mean over every scan ever taken, which never
 * forgets: after three hundred scans, a new one moves the baseline by 0.3%.
 * That is wrong for the thing being measured — resting HRV genuinely drifts
 * with sleep, illness, fitness and the season, so a baseline anchored to who
 * you were three months ago slowly stops describing you.
 *
 * Twenty is roughly a fortnight of ordinary use: long enough that a single bad
 * scan cannot move it much, short enough to follow a real change.
 */
export const BASELINE_WINDOW = 20;

/**
 * Median, not mean.
 *
 * One motion-artefact scan that slipped through the quality gate can drag a
 * twenty-sample mean noticeably. The median of the same twenty barely notices
 * it, and for a roughly symmetric distribution the two agree anyway — so this
 * costs nothing and removes a whole class of silent corruption.
 */
function rollingBaseline(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(median * 100) / 100;
}

/* ── Pillar 3: baseline, scans, self-reports ──────────────────────── */

/**
 * The baseline, derived from the scans rather than read from a column.
 *
 * The stored `rmssd_baseline` / `calibration_scans` are still written on every
 * spot check, because Pillar 4 reads them — but they are recomputed here from
 * the last BASELINE_WINDOW finger scans, and the derived value wins.
 *
 * That is not belt-and-braces, it is the fix for a real failure: when the
 * baseline moved from "every scan, cumulative" to "recent finger scans only",
 * anyone with existing history saw their count reset to 0/3 and Desk Mode
 * announce "baseline incomplete" after they had already done the scans. The
 * scans were still there; only the counter had been left behind. A stored
 * aggregate can disagree with the rows it summarises after any change to how it
 * is computed — deriving it means it cannot.
 */
export async function getBaseline(): Promise<Baseline> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const [{ data }, { data: scans }] = await Promise.all([
      supabase.from('baselines').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('ppg_scans')
        .select('hrv_rmssd')
        .eq('user_id', userId)
        .eq('source', 'finger')
        .eq('signal_quality', 'good')
        .not('hrv_rmssd', 'is', null)
        .order('created_at', { ascending: false })
        .limit(BASELINE_WINDOW),
    ]);
    const values = (scans ?? []).map((r) => r.hrv_rmssd as number);
    return {
      rmssdBaseline: rollingBaseline(values) ?? data?.rmssd_baseline ?? null,
      scanCount: data?.scan_count ?? 0,
      calibrationScans: values.length,
      perceivedStressBaseline: data?.perceived_stress_baseline ?? null,
      updatedAt: data?.updated_at ?? new Date().toISOString(),
    };
  }

  const db = await readDb();
  const values = db.scans
    .filter((sc) => sc.source === 'finger' && sc.signalQuality === 'good' && sc.hrvRmssd !== null)
    .slice(0, BASELINE_WINDOW)
    .map((sc) => sc.hrvRmssd as number);
  return {
    ...db.baseline,
    rmssdBaseline: rollingBaseline(values) ?? db.baseline.rmssdBaseline,
    calibrationScans: values.length,
  };
}

/**
 * Persists a scan and, for finger spot checks only, rolls the baseline forward.
 *
 * Only scalars are written. filteredSignal and ibiList are deliberately dropped
 * here — they stay on the device for the life of the screen and are never
 * uploaded, in line with the on-device-only promise.
 *
 * ── Why face scans never touch the baseline ─────────────────────────
 * The RMSSD baseline is a *resting* reference: what this person's autonomic
 * balance looks like when nothing is demanding anything of them. Desk Mode
 * readings are taken mid-task by definition. Feeding them into the same
 * cumulative average meant a single 25-minute session added dozens of
 * working-state samples on top of three resting ones, pulling the baseline down
 * to roughly the stressed value. Deviation is measured *against* that baseline,
 * so it collapsed toward zero and the classifier stopped reporting stress — the
 * app got worse the more it was used, silently, with no error anywhere.
 *
 * Face readings are still stored: they are the trend, the session curve and the
 * history. They are simply not evidence about rest.
 */
export async function saveScan(
  result: PPGResult,
  source: 'finger' | 'face',
  classification: StressClassification,
  options: { feedsBaseline?: boolean } = {}
): Promise<void> {
  const row = {
    source,
    heart_rate: result.heartRate,
    hrv_rmssd: result.hrvRmssd,
    stress_level: classification.stressLevel,
    deviation_pct: classification.deviationPct,
    signal_quality: result.signalQuality,
  };

  const feedsBaseline =
    (options.feedsBaseline ?? true) &&
    source === 'finger' &&
    result.signalQuality === 'good' &&
    result.hrvRmssd !== null;

  if (hasSupabase) {
    const userId = await currentUserId();
    await supabase.from('ppg_scans').insert({ ...row, user_id: userId });
    const base = await getBaseline();
    const patch: Record<string, unknown> = {
      user_id: userId,
      scan_count: base.scanCount + 1,
      updated_at: new Date().toISOString(),
    };
    if (feedsBaseline) {
      const { data } = await supabase
        .from('ppg_scans')
        .select('hrv_rmssd')
        .eq('user_id', userId)
        .eq('source', 'finger')
        .eq('signal_quality', 'good')
        .not('hrv_rmssd', 'is', null)
        .order('created_at', { ascending: false })
        .limit(BASELINE_WINDOW);
      const values = (data ?? []).map((r) => r.hrv_rmssd as number);
      patch.rmssd_baseline = rollingBaseline(values);
      patch.calibration_scans = values.length;
    }
    await supabase.from('baselines').upsert(patch);
    return;
  }

  await writeDb((db) => {
    db.scans.unshift({
      id: uid(),
      source,
      heartRate: result.heartRate,
      hrvRmssd: result.hrvRmssd,
      stressLevel: classification.stressLevel,
      deviationPct: classification.deviationPct,
      signalQuality: result.signalQuality,
      createdAt: new Date().toISOString(),
    });
    db.baseline.scanCount += 1;
    if (feedsBaseline) {
      const values = db.scans
        .filter((sc) => sc.source === 'finger' && sc.signalQuality === 'good' && sc.hrvRmssd !== null)
        .slice(0, BASELINE_WINDOW)
        .map((sc) => sc.hrvRmssd as number);
      db.baseline.rmssdBaseline = rollingBaseline(values);
      db.baseline.calibrationScans = values.length;
    }
    db.baseline.updatedAt = new Date().toISOString();
  });
}

export async function listScans(limit = 40): Promise<PpgScan[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('ppg_scans')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => ({
      id: r.id,
      source: r.source,
      heartRate: r.heart_rate,
      hrvRmssd: r.hrv_rmssd,
      stressLevel: r.stress_level,
      deviationPct: r.deviation_pct,
      signalQuality: r.signal_quality,
      createdAt: r.created_at,
    }));
  }
  return (await readDb()).scans.slice(0, limit);
}

export async function saveSelfReport(
  score: number,
  rawAnswers: Record<string, number> | null
): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    await supabase.from('self_reports').insert({ user_id: userId, score, raw_answers: rawAnswers });
    // First report only. This is a *baseline*, not "the latest answer" — the
    // Supabase path used to overwrite it every time, so it tracked the current
    // mood and the local path did not. Two backends, two different meanings for
    // the same column.
    const base = await getBaseline();
    if (base.perceivedStressBaseline === null) {
      await supabase.from('baselines').upsert({
        user_id: userId,
        perceived_stress_baseline: score,
        updated_at: new Date().toISOString(),
      });
    }
    return;
  }
  await writeDb((db) => {
    db.selfReports.unshift({ id: uid(), score, rawAnswers, createdAt: new Date().toISOString() });
    if (db.baseline.perceivedStressBaseline === null) db.baseline.perceivedStressBaseline = score;
  });
}

export async function latestSelfReport(): Promise<SelfReport | null> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('self_reports')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data
      ? { id: data.id, score: data.score, rawAnswers: data.raw_answers, createdAt: data.created_at }
      : null;
  }
  return (await readDb()).selfReports[0] ?? null;
}

/**
 * Whether the full questionnaire has ever been completed.
 *
 * Not the same as "the latest self-report has answers": a one-tap quick flag is
 * also a self-report, and it has no answers. Asking the latest row meant a
 * single tap on the mood row flipped the calibration screen's questionnaire
 * card back to "Not started".
 */
export async function hasQuestionnaireAnswers(): Promise<boolean> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('self_reports')
      .select('id')
      .eq('user_id', userId)
      .not('raw_answers', 'is', null)
      .limit(1);
    return (data ?? []).length > 0;
  }
  return (await readDb()).selfReports.some((r) => r.rawAnswers !== null);
}

/* ── Fused score (handoff to Pillar 4) ───────────────────────────── */

/**
 * Recomputes the fused score from whatever signals exist and persists it.
 * `loadScore` is Pillar 1's weekly-capacity number; until that pillar lands we
 * fuse without it and confidence drops accordingly — the honest behaviour
 * rather than a placeholder value that would fake agreement.
 */
export async function recomputeFusedScore(loadScore?: number): Promise<FusionResult> {
  const [scans, self] = await Promise.all([listScans(20), latestSelfReport()]);
  const usable = scans.filter((s) => s.signalQuality === 'good' && s.deviationPct !== null);
  // A 45-second finger scan under torch light and a 40-second face reading in
  // room light are not equally trustworthy, and taking whichever happened to be
  // most recent treated them as if they were. A recent spot check wins; a face
  // reading is the fallback, and the recency decay in fusionService still
  // discounts a stale one.
  const bio =
    usable.find((s) => s.source === 'finger' && ageHours(s.createdAt) < 12) ?? usable[0];

  const fusion = fuseStressScore({
    biometric:
      bio && bio.deviationPct !== null
        ? { score: PPGService.biometricScore(bio.deviationPct)!, ageHours: ageHours(bio.createdAt) }
        : undefined,
    selfReport: self ? { score: self.score, ageHours: ageHours(self.createdAt) } : undefined,
    load: loadScore !== undefined ? { score: loadScore, ageHours: 0 } : undefined,
  });

  if (fusion.fusedScore === null) return fusion;

  const row = {
    fused_score: Math.round(fusion.fusedScore * 100) / 100,
    confidence: fusion.confidence,
    signals_used: fusion.signalsUsed,
    biometric_score: bio?.deviationPct != null ? PPGService.biometricScore(bio.deviationPct) : null,
    self_report_score: self?.score ?? null,
    load_score: loadScore ?? null,
  };

  if (hasSupabase) {
    const userId = await currentUserId();
    await supabase.from('stress_scores').insert({ ...row, user_id: userId });
  } else {
    await writeDb((db) => {
      db.stressScores.unshift({
        id: uid(),
        fusedScore: row.fused_score,
        confidence: row.confidence,
        signalsUsed: row.signals_used,
        biometricScore: row.biometric_score,
        selfReportScore: row.self_report_score,
        loadScore: row.load_score,
        createdAt: new Date().toISOString(),
      });
    });
  }
  return fusion;
}

export async function listStressScores(limit = 30): Promise<StressScoreRow[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('stress_scores')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => ({
      id: r.id,
      fusedScore: r.fused_score,
      confidence: r.confidence,
      signalsUsed: r.signals_used,
      biometricScore: r.biometric_score,
      selfReportScore: r.self_report_score,
      loadScore: r.load_score,
      createdAt: r.created_at,
    }));
  }
  return (await readDb()).stressScores.slice(0, limit);
}

/* ── Pillar 2: sessions + calibration feedback ───────────────────── */

export async function saveSession(row: Omit<FocusSessionRow, 'id' | 'createdAt'>): Promise<string> {
  const id = uid();
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('focus_sessions')
      .insert({
        user_id: userId,
        started_at: row.startedAt,
        ended_at: row.endedAt,
        planned_minutes: row.plannedMinutes,
        actual_minutes: row.actualMinutes,
        breaks_taken: row.breaksTaken,
        enforced_breaks: row.enforcedBreaks,
        stress_delta_pct: row.stressDeltaPct,
        soundscape: row.soundscape,
      })
      .select('id')
      .single();
    return data?.id ?? id;
  }
  await writeDb((db) => {
    db.sessions.unshift({ ...row, id, createdAt: new Date().toISOString() });
  });
  return id;
}

export async function saveAccuracyFeedback(
  verdict: AccuracyVerdict,
  refs: { sessionId?: string | null; scanId?: string | null } = {}
): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    await supabase.from('calibration_feedback').insert({
      user_id: userId,
      session_id: refs.sessionId ?? null,
      scan_id: refs.scanId ?? null,
      verdict,
    });
    return;
  }
  await writeDb((db) => {
    db.feedback.unshift({
      id: uid(),
      sessionId: refs.sessionId ?? null,
      scanId: refs.scanId ?? null,
      verdict,
      createdAt: new Date().toISOString(),
    });
  });
}

/**
 * Rolling "Personal Accuracy" shown on the summary + calibration screens.
 * spot_on counts 1, slightly_off 0.5, way_off 0 — so the number moves honestly
 * instead of only counting perfect reads.
 */
export async function personalAccuracy(): Promise<{ pct: number | null; samples: number }> {
  let rows: { verdict: AccuracyVerdict }[];
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('calibration_feedback')
      .select('verdict')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    rows = data ?? [];
  } else {
    rows = (await readDb()).feedback.slice(0, 50);
  }
  if (rows.length === 0) return { pct: null, samples: 0 };
  const weight = { spot_on: 1, slightly_off: 0.5, way_off: 0 } as const;
  const total = rows.reduce((s, r) => s + weight[r.verdict], 0);
  return { pct: Math.round((total / rows.length) * 100), samples: rows.length };
}

/* ── Pillar 6: Circles ───────────────────────────────────────────── */

export async function getMyInviteCode(): Promise<string> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('profiles')
      .select('invite_code')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data.invite_code;
  }
  return (await readDb()).inviteCode;
}

/**
 * Your display name, as your circle sees it.
 *
 * Anonymous sign-in gives everyone a name like 'student_a1b2c3'. That is right
 * for privacy and wrong for a circle — two people who just invited each other
 * cannot tell which row is which, and "who is coming to this meetup" becomes
 * unanswerable. Nothing here is verified or public: it is a label, visible only
 * to people who already accepted a code from you.
 */
export async function getMyUsername(): Promise<string> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase.from('profiles').select('username').eq('id', userId).single();
    return data?.username ?? 'you';
  }
  return (await readDb()).username;
}

export async function setMyUsername(name: string): Promise<string> {
  const cleaned = name.trim();
  if (cleaned.length < 2) throw new Error('Pick a name of at least 2 characters');
  if (hasSupabase) {
    const { data, error } = await supabase.rpc('set_username', { new_username: cleaned });
    if (error) throw new Error(error.message);
    return data as string;
  }
  await writeDb((db) => {
    db.username = cleaned;
  });
  return cleaned;
}

export async function sendFriendRequestByCode(inviteCode: string): Promise<void> {
  const code = inviteCode.trim().toUpperCase();
  if (!code) throw new Error('Enter an invite code');

  if (hasSupabase) {
    const { data: recipient, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('invite_code', code)
      .maybeSingle();
    if (error || !recipient) throw new Error('Invite code not found');

    const userId = await currentUserId();
    if (recipient.id === userId) throw new Error('That is your own code');

    const { error: insertError } = await supabase
      .from('friend_requests')
      .insert({ requester_id: userId, recipient_id: recipient.id });
    if (insertError) throw new Error('Request already sent');
    return;
  }

  // Demo store: the code is accepted and appears as an incoming request you can
  // accept, so the whole flow is walkable on a single device.
  await writeDb((db) => {
    if (code === db.inviteCode) throw new Error('That is your own code');
    if (db.friends.some((f) => f.username === code)) throw new Error('Already in your circle');
    db.requests.unshift({ id: uid(), requesterId: uid(), username: code });
  });
}

export async function getIncomingRequests(): Promise<IncomingRequest[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('friend_requests')
      .select('id, requester_id, profiles!friend_requests_requester_id_fkey(username)')
      .eq('recipient_id', userId)
      .eq('status', 'pending');
    return (data ?? []).map((r: any) => ({
      id: r.id,
      requesterId: r.requester_id,
      username: r.profiles?.username ?? 'someone',
    }));
  }
  return (await readDb()).requests;
}

export async function acceptFriendRequest(requestId: string): Promise<void> {
  if (hasSupabase) {
    const { error } = await supabase.rpc('accept_friend_request', { request_id: requestId });
    if (error) throw error;
    return;
  }
  await writeDb((db) => {
    const req = db.requests.find((r) => r.id === requestId);
    if (!req) return;
    db.requests = db.requests.filter((r) => r.id !== requestId);
    db.friends.unshift({ friendId: req.requesterId, username: req.username });
  });
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  if (hasSupabase) {
    const { error } = await supabase
      .from('friend_requests')
      .update({ status: 'declined' })
      .eq('id', requestId);
    if (error) throw error;
    return;
  }
  await writeDb((db) => {
    db.requests = db.requests.filter((r) => r.id !== requestId);
  });
}

export async function getFriends(): Promise<FriendSummary[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('friendships')
      .select('friend_id, profiles!friendships_friend_id_fkey(username)')
      .eq('user_id', userId);
    return (data ?? []).map((r: any) => ({
      friendId: r.friend_id,
      username: r.profiles?.username ?? 'friend',
    }));
  }
  return (await readDb()).friends;
}

/**
 * Circle aggregate. Counts only — never a per-friend score, and nothing at all
 * below MIN_CIRCLE_SIZE, where "2 of 2 in the red zone" would let you read an
 * individual straight off the card. The server function enforces the same rule;
 * this is belt-and-braces for the demo store path.
 */
export async function getCircleSummary(): Promise<CircleSummary> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data, error } = await supabase.rpc('get_circle_summary', { target_user_id: userId });
    if (error) throw error;
    const row = data?.[0];
    const total = row?.total_friends ?? 0;
    const suppressed = total < MIN_CIRCLE_SIZE || row?.red_zone_count === null;
    return {
      totalFriends: total,
      redZoneCount: suppressed ? null : row.red_zone_count,
      avgCapacity: suppressed ? null : row.avg_capacity,
      suppressed,
    };
  }

  const db = await readDb();
  const total = db.friends.length;
  const suppressed = total < MIN_CIRCLE_SIZE;
  // The demo store has no friend scores to read; the shape is what matters here.
  const red = suppressed ? 0 : Math.max(1, Math.round(total * 0.5));
  return {
    totalFriends: total,
    redZoneCount: suppressed ? null : red,
    avgCapacity: suppressed ? null : 78,
    suppressed,
  };
}

export async function listChallenges(): Promise<ChallengeRow[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase.rpc('list_challenges', { target_user_id: userId });
    return (data ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      scheduledFor: r.scheduled_for,
      category: r.category,
      kind: r.kind ?? 'solo',
      location: r.location ?? null,
      capacity: r.capacity ?? null,
      verifyWith: (r.verify_with ?? null) as ChallengeRow['verifyWith'],
      cancelled: r.cancelled ?? false,
      updatedAt: r.updated_at ?? null,
      joinedCount: r.joined_count,
      completedCount: r.completed_count ?? 0,
      circleSize: r.circle_size,
      joined: r.joined,
      completedByMe: r.completed_by_me ?? false,
      verifiedByMe: r.verified_by_me ?? false,
      createdBy: r.created_by ?? null,
      createdByMe: r.created_by_me ?? false,
      notes: r.notes ?? null,
      participants: (r.participants ?? []) as Participant[],
    }));
  }
  // Demo store: join counts scale with the real circle rather than showing a
  // fabricated "3 of 4 joined" for a user who has no friends yet.
  const db = await readDb();
  const circleSize = db.friends.length + 1;
  return db.challenges.map((ch) => ({
    ...ch,
    circleSize,
    joinedCount: Math.min(ch.joinedCount, circleSize),
  }));
}

export async function getChallenge(id: string): Promise<ChallengeRow | null> {
  const all = await listChallenges();
  return all.find((c) => c.id === id) ?? null;
}

/**
 * Creates a challenge visible to the author's circle.
 *
 * Note what is NOT stored: who it is "for". A challenge is an open invitation
 * to the whole circle, never something aimed at the person Wick thinks is
 * struggling — that would leak the very signal the pillar keeps private.
 */
export async function createChallenge(input: NewChallenge): Promise<string> {
  if (hasSupabase) {
    const { data, error } = await supabase.rpc('create_challenge', {
      p_title: input.title,
      p_subtitle: input.subtitle,
      p_scheduled_for: input.scheduledFor,
      p_category: input.category,
      p_kind: input.kind,
      p_location: input.location,
      p_capacity: input.capacity,
      p_notes: input.notes,
      p_verify_with: input.verifyWith,
    });
    if (error) throw error;
    return data as string;
  }
  const id = uid();
  await writeDb((db) => {
    db.challenges.unshift({
      id,
      title: input.title,
      subtitle: input.subtitle,
      scheduledFor: input.scheduledFor,
      category: input.category,
      kind: input.kind,
      location: input.location,
      capacity: input.capacity,
      verifyWith: input.verifyWith,
      cancelled: false,
      updatedAt: null,
      joinedCount: 1,
      completedCount: 0,
      circleSize: db.friends.length + 1,
      joined: true,
      completedByMe: false,
      verifiedByMe: false,
      createdBy: 'me',
      createdByMe: true,
      notes: input.notes,
      participants: [
        { userId: 'me', username: 'You', completed: false, verified: false, isMe: true },
      ],
    });
  });
  return id;
}

/** Creator-only edit. Everything except the id can change. */
export async function updateChallenge(id: string, input: NewChallenge): Promise<void> {
  if (hasSupabase) {
    const { error } = await supabase.rpc('update_challenge', {
      challenge_id: id,
      p_title: input.title,
      p_subtitle: input.subtitle,
      p_scheduled_for: input.scheduledFor,
      p_category: input.category,
      p_kind: input.kind,
      p_location: input.location,
      p_capacity: input.capacity,
      p_notes: input.notes,
      p_verify_with: input.verifyWith,
    });
    if (error) throw error;
    return;
  }
  await writeDb((db) => {
    const ch = db.challenges.find((c) => c.id === id);
    if (!ch || !ch.createdByMe) return;
    Object.assign(ch, {
      title: input.title,
      subtitle: input.subtitle,
      scheduledFor: input.scheduledFor,
      category: input.category,
      kind: input.kind,
      location: input.location,
      capacity: input.capacity,
      verifyWith: input.verifyWith,
      notes: input.notes,
      updatedAt: ch.participants.some((p) => !p.isMe) ? new Date().toISOString() : ch.updatedAt,
    });
  });
}

/**
 * Marks your own participation complete.
 *
 * Self-reported on purpose. Wick can verify a recovery *break* through the
 * biometric loop, but it cannot verify that four friends walked round a lake,
 * and pretending otherwise would be a worse lie than trusting them.
 */
export async function completeChallenge(
  id: string,
  done: boolean,
  verified = false
): Promise<void> {
  if (hasSupabase) {
    const { error } = await supabase.rpc('complete_challenge', {
      challenge_id: id,
      p_done: done,
      p_verified: verified,
    });
    if (error) throw error;
    return;
  }
  await writeDb((db) => {
    const ch = db.challenges.find((c) => c.id === id);
    if (!ch) return;
    const me = ch.participants.find((p) => p.isMe);
    if (me) {
      me.completed = done;
      me.verified = done && verified;
    }
    ch.completedByMe = done;
    ch.verifiedByMe = done && verified;
    ch.completedCount = ch.participants.filter((p) => p.completed).length;
  });
}

/**
 * Hard delete. Only available while you are the only participant.
 *
 * Once anyone else has joined, the challenge is in their history and possibly
 * in their evening's plans; deleting it would take rows out of someone else's
 * record and leave a meetup they had arranged around simply gone, with nothing
 * to explain it. cancelChallenge is the operation for that case, and the server
 * refuses this one.
 */
export async function deleteChallenge(id: string): Promise<void> {
  if (hasSupabase) {
    const { error } = await supabase.rpc('delete_challenge', { challenge_id: id });
    if (error) throw new Error(error.message);
    return;
  }
  await writeDb((db) => {
    const ch = db.challenges.find((c) => c.id === id);
    if (ch && ch.participants.some((p) => !p.isMe)) {
      throw new Error('Others have joined — cancel it instead, so it stays in their history');
    }
    db.challenges = db.challenges.filter((c) => c.id !== id);
  });
}

/**
 * Calls a challenge off without erasing it. It stays visible to everyone who
 * joined, clearly marked, and closed to new joins. Completions already recorded
 * are left alone — somebody who did the thing before it was called off still
 * did it.
 */
export async function cancelChallenge(id: string, cancelled: boolean): Promise<void> {
  if (hasSupabase) {
    const { error } = await supabase.rpc('cancel_challenge', {
      challenge_id: id,
      p_cancelled: cancelled,
    });
    if (error) throw new Error(error.message);
    return;
  }
  await writeDb((db) => {
    const ch = db.challenges.find((c) => c.id === id);
    if (ch) ch.cancelled = cancelled;
  });
}

export async function toggleChallenge(id: string): Promise<void> {
  if (hasSupabase) {
    const { error } = await supabase.rpc('toggle_challenge', { challenge_id: id });
    if (error) throw error;
    return;
  }
  await writeDb((db) => {
    const ch = db.challenges.find((x) => x.id === id);
    if (!ch) return;
    if (!ch.joined && ch.cancelled) {
      throw new Error('This challenge was cancelled');
    }
    if (!ch.joined && ch.capacity !== null && ch.joinedCount >= ch.capacity) {
      throw new Error('This challenge is full');
    }
    ch.joined = !ch.joined;
    if (ch.joined) {
      ch.participants.push({
        userId: 'me',
        username: 'You',
        completed: false,
        verified: false,
        isMe: true,
      });
    } else {
      ch.participants = ch.participants.filter((p) => !p.isMe);
      ch.completedByMe = false;
      ch.verifiedByMe = false;
    }
    ch.joinedCount = ch.participants.length;
    ch.completedCount = ch.participants.filter((p) => p.completed).length;
  });
}

/**
 * Sends a supportive nudge to the circle. Deliberately takes no recipient: the
 * sender is never told which friend is struggling, so support fans out to
 * whoever is currently flagged and nobody's state leaks back to the sender.
 * Returns how many people it reached.
 */
export async function sendCircleSupport(message: string): Promise<number> {
  if (hasSupabase) {
    const { data, error } = await supabase.rpc('send_circle_support', { body: message });
    if (error) throw error;
    return data ?? 0;
  }
  // Demo store: there are no other devices, so the nudge is delivered to this
  // one. Without it the send half of the loop would be walkable and the receive
  // half would not, which is exactly the gap this pair of functions closes.
  const db = await readDb();
  const reach = db.friends.length;
  if (reach > 0) {
    await writeDb((d) => {
      d.nudges.unshift({
        id: uid(),
        body: message,
        createdAt: new Date().toISOString(),
        seenAt: null,
      });
    });
  }
  return reach;
}

/**
 * Support that arrived for you.
 *
 * The other half of sendCircleSupport, which until now wrote rows nothing ever
 * read: you could send encouragement and nobody could receive it.
 *
 * There is no sender on these, by design and in both directions. The sender was
 * never told who was struggling; the recipient is never told who reached out.
 * What survives the anonymity is the only part that actually helps — that
 * somebody in your circle thought of you.
 */
export async function listSupportNudges(limit = 20): Promise<SupportNudge[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('support_nudges')
      .select('id, body, created_at, seen_at')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      seenAt: r.seen_at,
    }));
  }
  return (await readDb()).nudges.slice(0, limit);
}

/** Marks everything currently unseen as seen. */
export async function markNudgesSeen(): Promise<void> {
  const now = new Date().toISOString();
  if (hasSupabase) {
    const userId = await currentUserId();
    await supabase
      .from('support_nudges')
      .update({ seen_at: now })
      .eq('recipient_id', userId)
      .is('seen_at', null);
    return;
  }
  await writeDb((db) => {
    db.nudges.forEach((n) => {
      if (!n.seenAt) n.seenAt = now;
    });
  });
}

/**
 * Leaves a circle, in both directions.
 *
 * Symmetrical because a circle is a mutual arrangement — a one-sided version
 * would leave the other person still seeing someone who has gone. Silent
 * because a "X removed you" notification turns a quiet boundary into a
 * confrontation, and that is precisely what keeps people in circles they want
 * out of. Nothing but the link is deleted; neither side ever had access to the
 * other's readings in the first place.
 */
export async function removeFriend(friendId: string): Promise<void> {
  if (hasSupabase) {
    const { error } = await supabase.rpc('remove_friend', { other_user_id: friendId });
    if (error) throw error;
    return;
  }
  await writeDb((db) => {
    db.friends = db.friends.filter((f) => f.friendId !== friendId);
  });
}

/** True when at least one friend in the circle is currently flagged as overloaded. */
export async function circleNeedsSupport(): Promise<boolean> {
  const summary = await getCircleSummary();
  return !summary.suppressed && (summary.redZoneCount ?? 0) > 0;
}

/* ── Pillar 1: Calendar Sync & Workload ───────────────────────────────────── */

export async function getCalendarConnections(): Promise<CalendarConnection[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('calendar_connections')
      .select('provider, connected, account_email, last_synced_at')
      .eq('user_id', userId);
    return (data ?? []).map((r: any) => ({
      provider: r.provider,
      connected: r.connected,
      accountEmail: r.account_email,
      lastSyncedAt: r.last_synced_at,
    }));
  }
  return [];
}

export async function saveCalendarConnection(
  provider: 'google' | 'outlook',
  connected: boolean,
  accountEmail?: string
): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) return;
    await supabase.from('calendar_connections').upsert({
      user_id: userId,
      provider,
      connected,
      account_email: accountEmail,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });
    return;
  }
}

export async function getWorkloadItems(status?: string): Promise<TaskAnalysis[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    let query = supabase
      .from('workload_items')
      .select('*')
      .eq('user_id', userId)
      .order('scheduled_start', { ascending: true });

    if (status) {
      query = query.eq('status', status);
    }

    const { data } = await query;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      priority: r.priority,
      estimated_duration_hours: r.estimated_hours,
      scheduled_date: r.scheduled_start ? new Date(r.scheduled_start).toISOString().split('T')[0] : '',
      scheduled_start_time: r.scheduled_start ? new Date(r.scheduled_start).toISOString().split('T')[1].slice(0, 5) : undefined,
      scheduled_end_time: r.scheduled_end ? new Date(r.scheduled_end).toISOString().split('T')[1].slice(0, 5) : undefined,
      capacity_hours: r.estimated_hours,
      rank: 0,
      status: r.status,
      calendar_event_id: r.calendar_event_id,
      calendar_provider: r.source === 'google' || r.source === 'outlook' ? r.source : undefined,
      createdAt: r.created_at,
    }));
  }

  // Fallback to local store
  const db = await readDb();
  let items = db.workloadItems || [];
  if (status) {
    items = items.filter((item) => item.status === status);
  }
  return [...items]
    .sort((a, b) => {
      const aTime = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
      const bTime = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
      return aTime - bTime;
    })
    .map((r: WorkloadItem) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      priority: r.priority,
      estimated_duration_hours: r.estimated_hours,
      scheduled_date: r.scheduled_start ? new Date(r.scheduled_start).toISOString().split('T')[0] : '',
      scheduled_start_time: r.scheduled_start ? new Date(r.scheduled_start).toISOString().split('T')[1].slice(0, 5) : undefined,
      scheduled_end_time: r.scheduled_end ? new Date(r.scheduled_end).toISOString().split('T')[1].slice(0, 5) : undefined,
      capacity_hours: r.estimated_hours,
      rank: 0,
      status: r.status as TaskAnalysis['status'],
      calendar_event_id: r.calendar_event_id,
      calendar_provider: r.source === 'google' || r.source === 'outlook' ? r.source : undefined,
      createdAt: r.createdAt,
    }));
}

export async function createWorkloadItem(item: Omit<TaskAnalysis, 'id' | 'createdAt'>): Promise<string> {
  const id = uid();
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) return id;

    const scheduledStart = item.scheduled_date ? new Date(`${item.scheduled_date}T${item.scheduled_start_time || '00:00'}`).toISOString() : new Date().toISOString();
    const scheduledEnd = item.scheduled_date ? new Date(`${item.scheduled_date}T${item.scheduled_end_time || '23:59'}`).toISOString() : new Date().toISOString();

    const { data, error } = await supabase
      .from('workload_items')
      .insert({
        user_id: userId,
        title: item.title,
        category: item.category,
        estimated_hours: item.estimated_duration_hours,
        priority: item.priority,
        source: item.calendar_provider || 'manual',
        status: item.status || 'scheduled',
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
        calendar_event_id: item.calendar_event_id,
      })
      .select('id')
      .single();

    if (error) throw error;
    return data?.id ?? id;
  }

  // Local store fallback
  await writeDb((db) => {
    db.workloadItems = db.workloadItems || [];
    db.workloadItems.unshift({
      id,
      title: item.title,
      category: item.category,
      priority: item.priority,
      estimated_hours: item.estimated_duration_hours,
      scheduled_start: item.scheduled_date ? new Date(`${item.scheduled_date}T${item.scheduled_start_time || '00:00'}`).toISOString() : new Date().toISOString(),
      scheduled_end: item.scheduled_date ? new Date(`${item.scheduled_date}T${item.scheduled_end_time || '23:59'}`).toISOString() : new Date().toISOString(),
      status: item.status || 'scheduled',
      calendar_event_id: item.calendar_event_id,
      source: item.calendar_provider || 'manual',
      createdAt: new Date().toISOString(),
    });
  });
  return id;
}

export async function updateWorkloadItem(id: string, updates: Partial<TaskAnalysis>): Promise<void> {
  if (hasSupabase) {
    const patch: any = {};
    if (updates.title) patch.title = updates.title;
    if (updates.category) patch.category = updates.category;
    if (updates.priority) patch.priority = updates.priority;
    if (updates.estimated_duration_hours) patch.estimated_hours = updates.estimated_duration_hours;
    if (updates.status) patch.status = updates.status;

    if (updates.scheduled_date || updates.scheduled_start_time) {
      const existing = await getWorkloadItemById(id);
      if (existing) {
        const date = updates.scheduled_date || existing.scheduled_date;
        const start = updates.scheduled_start_time || existing.scheduled_start_time || '00:00';
        patch.scheduled_start = new Date(`${date}T${start}`).toISOString();
      }
    }

    if (updates.scheduled_date || updates.scheduled_end_time) {
      const existing = await getWorkloadItemById(id);
      if (existing) {
        const date = updates.scheduled_date || existing.scheduled_date;
        const end = updates.scheduled_end_time || existing.scheduled_end_time || '23:59';
        patch.scheduled_end = new Date(`${date}T${end}`).toISOString();
      }
    }

    if (updates.calendar_event_id) patch.calendar_event_id = updates.calendar_event_id;

    const { error } = await supabase.from('workload_items').update(patch).eq('id', id);
    if (error) throw error;
  }

  // Local store fallback
  await writeDb((db) => {
    const idx = (db.workloadItems || []).findIndex((item) => item.id === id);
    if (idx >= 0) {
      const item = db.workloadItems[idx];
      const schedDate = updates.scheduled_date || (item.scheduled_start ? new Date(item.scheduled_start).toISOString().split('T')[0] : undefined);
      const startTime = updates.scheduled_start_time || (item.scheduled_start ? new Date(item.scheduled_start).toTimeString().slice(0, 5) : undefined);
      const endTime = updates.scheduled_end_time || (item.scheduled_end ? new Date(item.scheduled_end).toTimeString().slice(0, 5) : undefined);

      db.workloadItems[idx] = {
        ...item,
        ...updates,
        estimated_hours: updates.estimated_duration_hours ?? item.estimated_hours,
        scheduled_start: (updates.scheduled_date || updates.scheduled_start_time) ? new Date(`${schedDate}T${startTime || '00:00'}`).toISOString() : item.scheduled_start,
        scheduled_end: (updates.scheduled_date || updates.scheduled_end_time) ? new Date(`${schedDate}T${endTime || '23:59'}`).toISOString() : item.scheduled_end,
      };
    }
  });
}

export async function deleteWorkloadItem(id: string): Promise<void> {
  if (hasSupabase) {
    const { error } = await supabase.from('workload_items').delete().eq('id', id);
    if (error) throw error;
  }

  // Local store fallback
  await writeDb((db) => {
    db.workloadItems = (db.workloadItems || []).filter((item) => item.id !== id);
  });
}

async function getWorkloadItemById(id: string): Promise<TaskAnalysis | null> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase
      .from('workload_items')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id,
      title: data.title,
      category: data.category,
      priority: data.priority,
      estimated_duration_hours: data.estimated_hours,
      scheduled_date: new Date(data.scheduled_start).toISOString().split('T')[0],
      scheduled_start_time: new Date(data.scheduled_start).toISOString().split('T')[1].slice(0, 5),
      scheduled_end_time: data.scheduled_end ? new Date(data.scheduled_end).toISOString().split('T')[1].slice(0, 5) : undefined,
      capacity_hours: data.estimated_hours,
      rank: 0,
      status: data.status,
      calendar_event_id: data.calendar_event_id,
      calendar_provider: data.source === 'google' || data.source === 'outlook' ? data.source : undefined,
      createdAt: data.created_at,
    };
  }
  return null;
}

export async function saveTaskAnalysis(analysis: TaskAnalysis): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (userId) {
      const weekStart = analysis.week_start || new Date().toISOString().split('T')[0];
      const scheduledStart = analysis.scheduled_date
        ? new Date(`${analysis.scheduled_date}T${analysis.scheduled_start_time || '00:00'}`).toISOString()
        : new Date().toISOString();
      const scheduledEnd = analysis.scheduled_date
        ? new Date(`${analysis.scheduled_date}T${analysis.scheduled_end_time || '23:59'}`).toISOString()
        : scheduledStart;

      const payload = {
        id: analysis.id,
        user_id: userId,
        week_start: weekStart,
        title: analysis.title,
        category: analysis.category,
        priority: analysis.priority,
        estimated_duration_hours: analysis.estimated_duration_hours,
        scheduled_date: analysis.scheduled_date,
        scheduled_start_time: analysis.scheduled_start_time,
        scheduled_end_time: analysis.scheduled_end_time,
        capacity_hours: analysis.capacity_hours,
        rank: analysis.rank,
        stress_score: analysis.stress_score,
        ai_reasoning: analysis.ai_reasoning,
        status: analysis.status || 'pending',
        calendar_event_id: analysis.calendar_event_id,
        calendar_provider: analysis.calendar_provider,
      };

      // Try upsert first (update if id already exists)
      const { error: upsertError } = await supabase
        .from('ai_task_analysis')
        .upsert(payload, { onConflict: 'id' });

      if (upsertError) {
        // Fallback: try a plain insert (id will be auto-generated by the DB if needed)
        const { error: insertError } = await supabase
          .from('ai_task_analysis')
          .insert(payload);
        if (insertError) {
          console.error('saveTaskAnalysis insert failed:', insertError.message);
        }
      }
    }
  }

  await writeDb((db) => {
    db.taskAnalyses = db.taskAnalyses || [];
    const idx = db.taskAnalyses.findIndex((t) => t.id === analysis.id);
    if (idx >= 0) {
      db.taskAnalyses[idx] = { ...db.taskAnalyses[idx], ...analysis };
    } else {
      db.taskAnalyses.push(analysis);
    }
  });
}

export async function getTaskAnalyses(weekStart?: string): Promise<TaskAnalysis[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (userId) {
      let query = supabase
        .from('ai_task_analysis')
        .select('*')
        .eq('user_id', userId)
        .order('rank', { ascending: true });

      if (weekStart) {
        query = query.eq('week_start', weekStart);
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        return data.map((r: any) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          priority: r.priority,
          estimated_duration_hours: r.estimated_duration_hours,
          scheduled_date: r.scheduled_date,
          scheduled_start_time: r.scheduled_start_time,
          scheduled_end_time: r.scheduled_end_time,
          capacity_hours: r.capacity_hours,
          rank: r.rank,
          ai_reasoning: r.ai_reasoning,
          stress_score: r.stress_score,
          status: r.status,
          calendar_event_id: r.calendar_event_id,
          calendar_provider: r.calendar_provider,
          week_start: r.week_start,
          createdAt: r.created_at,
        }));
      }

      // Fallback: if ai_task_analysis is empty, build from workload_items
      if (weekStart) {
        const { data: wlData } = await supabase
          .from('workload_items')
          .select('*')
          .eq('user_id', userId)
          .order('scheduled_start', { ascending: true });

        if (wlData && wlData.length > 0) {
          const weekStartMs = new Date(weekStart + 'T00:00:00').getTime();
          const weekEndMs = weekStartMs + 7 * 86400000;
          const filtered = wlData.filter((r: any) => {
            if (!r.scheduled_start) return false;
            const t = new Date(r.scheduled_start).getTime();
            return t >= weekStartMs && t < weekEndMs;
          });
          if (filtered.length > 0) {
            return filtered.map((r: any, idx: number) => ({
              id: r.id,
              title: r.title,
              category: r.category || 'academic',
              priority: r.priority || 'medium',
              estimated_duration_hours: r.estimated_hours || 1,
              scheduled_date: r.scheduled_start ? new Date(r.scheduled_start).toISOString().split('T')[0] : '',
              scheduled_start_time: r.scheduled_start ? new Date(r.scheduled_start).toISOString().split('T')[1].slice(0, 5) : undefined,
              scheduled_end_time: r.scheduled_end ? new Date(r.scheduled_end).toISOString().split('T')[1].slice(0, 5) : undefined,
              capacity_hours: r.estimated_hours || 1,
              rank: idx + 1,
              ai_reasoning: 'Synced from calendar.',
              stress_score: 50,
              status: r.status || 'pending',
              calendar_event_id: r.calendar_event_id,
              calendar_provider: r.source === 'google' || r.source === 'outlook' ? r.source : undefined,
              week_start: weekStart,
              createdAt: r.created_at,
            }));
          }
        }
      }
    }
  }

  // Fallback to local store
  const db = await readDb();
  let list = db.taskAnalyses || [];
  if (weekStart) {
    list = list.filter((t) => t.week_start === weekStart);
  }
  return [...list].sort((a, b) => (a.rank || 0) - (b.rank || 0));
}

export async function approveTaskAnalysis(id: string, approved: boolean): Promise<void> {
  const status = approved ? 'approved' : 'rejected';
  if (hasSupabase) {
    await supabase
      .from('ai_task_analysis')
      .update({ status })
      .eq('id', id);
  }
  let targetWeekStart: string | undefined;
  await writeDb((db) => {
    const item = (db.taskAnalyses || []).find((t) => t.id === id);
    if (item) {
      item.status = status;
      targetWeekStart = item.week_start;
    }
  });
  await recomputeCurrentWeekDerivedData(targetWeekStart);
}

/**
 * Generic update for an AI task analysis row. Supports editing category,
 * priority, rank, title, duration, schedule and status so the review UI can
 * let the user override any auto-detected detail.
 */
export async function updateTaskAnalysis(
  id: string,
  patch: Partial<TaskAnalysis>,
  skipDerivedRecompute = false
): Promise<void> {
  if (hasSupabase) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.category !== undefined) dbPatch.category = patch.category;
    if (patch.priority !== undefined) dbPatch.priority = patch.priority;
    if (patch.rank !== undefined) dbPatch.rank = patch.rank;
    if (patch.estimated_duration_hours !== undefined) dbPatch.estimated_duration_hours = patch.estimated_duration_hours;
    if (patch.scheduled_date !== undefined) dbPatch.scheduled_date = patch.scheduled_date;
    if (patch.scheduled_start_time !== undefined) dbPatch.scheduled_start_time = patch.scheduled_start_time;
    if (patch.scheduled_end_time !== undefined) dbPatch.scheduled_end_time = patch.scheduled_end_time;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.stress_score !== undefined) dbPatch.stress_score = patch.stress_score;
    if (patch.ai_reasoning !== undefined) dbPatch.ai_reasoning = patch.ai_reasoning;
    if (patch.week_start !== undefined) dbPatch.week_start = patch.week_start;
    if (Object.keys(dbPatch).length > 0) {
      await supabase.from('ai_task_analysis').update(dbPatch).eq('id', id);
    }
  }
  let targetWeekStart: string | undefined = patch.week_start;
  await writeDb((db) => {
    const item = (db.taskAnalyses || []).find((t) => t.id === id);
    if (item) {
      Object.assign(item, patch);
      if (!targetWeekStart) targetWeekStart = item.week_start;
    }
  });

  if (!skipDerivedRecompute) {
    await recomputeCurrentWeekDerivedData(targetWeekStart);
  }
}

export async function deferTaskAnalysis(id: string, newDate?: string): Promise<void> {
  if (hasSupabase) {
    const patch: any = { status: 'deferred' };
    if (newDate) patch.scheduled_date = newDate;
    await supabase.from('ai_task_analysis').update(patch).eq('id', id);
  }
  let targetWeekStart: string | undefined;
  await writeDb((db) => {
    const item = (db.taskAnalyses || []).find((t) => t.id === id);
    if (item) {
      item.status = 'deferred';
      if (newDate) item.scheduled_date = newDate;
      targetWeekStart = item.week_start;
    }
  });
  await recomputeCurrentWeekDerivedData(targetWeekStart);
}

export async function deleteTaskAnalysis(id: string): Promise<void> {
  if (hasSupabase) {
    await supabase.from('ai_task_analysis').delete().eq('id', id);
  }
  let targetWeekStart: string | undefined;
  await writeDb((db) => {
    const item = (db.taskAnalyses || []).find((t) => t.id === id);
    if (item) {
      targetWeekStart = item.week_start;
    }
    db.taskAnalyses = (db.taskAnalyses || []).filter((t) => t.id !== id);
  });
  await recomputeCurrentWeekDerivedData(targetWeekStart);
}

export async function saveWeeklyCapacity(capacity: WeeklyCapacityAnalysis): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (userId) {
      await supabase.from('weekly_capacity_analyses').upsert({
        user_id: userId,
        week_start: capacity.week_start,
        total_capacity_hours: capacity.total_capacity_hours,
        used_capacity_hours: capacity.used_capacity_hours,
        overload_warning: capacity.overload_warning,
        category_breakdown: capacity.category_breakdown,
        stress_score: capacity.stress_score,
        ai_reasoning: capacity.ai_reasoning,
      }, { onConflict: 'user_id,week_start' });
    }
  }
  await writeDb((db) => {
    db.weeklyCapacities = db.weeklyCapacities || [];
    const idx = db.weeklyCapacities.findIndex((c) => c.week_start === capacity.week_start);
    if (idx >= 0) {
      db.weeklyCapacities[idx] = capacity;
    } else {
      db.weeklyCapacities.push(capacity);
    }
  });
}

export async function getWeeklyCapacity(weekStart?: string): Promise<WeeklyCapacityAnalysis | null> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (userId) {
      let query = supabase
        .from('weekly_capacity_analyses')
        .select('*')
        .eq('user_id', userId);

      if (weekStart) {
        query = query.eq('week_start', weekStart);
      } else {
        query = query.order('week_start', { ascending: false }).limit(1);
      }

      const { data } = await query;
      const row = data?.[0];
      if (row) {
        return {
          id: row.id,
          week_start: row.week_start,
          total_capacity_hours: row.total_capacity_hours,
          used_capacity_hours: row.used_capacity_hours,
          overload_warning: row.overload_warning,
          category_breakdown: row.category_breakdown || {},
          stress_score: row.stress_score,
          ai_reasoning: row.ai_reasoning,
          createdAt: row.created_at,
        };
      }
    }
  }

  // Fallback to local store
  const db = await readDb();
  const list = db.weeklyCapacities || [];
  if (weekStart) {
    return list.find((c) => c.week_start === weekStart) || null;
  }
  return list[list.length - 1] || null;
}

export async function saveChatLog(message: string, sender: 'user' | 'ai', taskId?: string): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (userId) {
      await supabase.from('task_chat_logs').insert({
        user_id: userId,
        message,
        sender,
        task_id: taskId,
      });
    }
  }
}

export async function getChatLogs(limit = 50): Promise<Array<{ message: string; sender: string; createdAt: string }>> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (userId) {
      const { data } = await supabase
        .from('task_chat_logs')
        .select('message, sender, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      return (data ?? []).reverse().map((r: any) => ({
        message: r.message,
        sender: r.sender,
        createdAt: r.created_at,
      }));
    }
  }
  return [];
}

/**
 * Two-way task creation: Adds to device native calendar + persists in database + re-evaluates capacity.
 */
/**
 * Recomputes and persists all derived data for the given week:
 * 1. Re-ranks active tasks (Priority High > Medium > Low, then stress score / schedule; completed/deferred to bottom)
 * 2. Analyzes weekly capacity with AI / heuristics
 * 3. Persists WeeklyCapacityAnalysis to DB
 * 4. Recomputes fused stress score
 */
export async function recomputeCurrentWeekDerivedData(
  weekStartStr?: string
): Promise<WeeklyCapacityAnalysis | null> {
  const now = new Date();
  const weekStart =
    weekStartStr ||
    (() => {
      const d = new Date(now);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      return d.toISOString().split('T')[0];
    })();

  const allTasks = await getTaskAnalyses(weekStart);

  // Re-rank active tasks
  const priorityWeight: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const sorted = [...allTasks].sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (b.status === 'completed' && a.status !== 'completed') return -1;
    if (a.status === 'deferred' && b.status !== 'deferred') return 1;
    if (b.status === 'deferred' && a.status !== 'deferred') return -1;

    const pDiff = (priorityWeight[b.priority] || 2) - (priorityWeight[a.priority] || 2);
    if (pDiff !== 0) return pDiff;
    return (b.stress_score ?? 50) - (a.stress_score ?? 50);
  });

  // Assign and persist new ranks if changed
  for (let i = 0; i < sorted.length; i++) {
    const newRank = i + 1;
    if (sorted[i].rank !== newRank) {
      sorted[i].rank = newRank;
      await updateTaskAnalysis(sorted[i].id, { rank: newRank }, true);
    }
  }

  const perceivedStress = await getBaseline();
  const { analyzeWeeklyCapacity } = await import('@/services/aiService');
  const activeTasks = sorted.filter((t) => t.status !== 'rejected' && t.status !== 'deferred');

  let capacity: WeeklyCapacityAnalysis;
  try {
    capacity = await analyzeWeeklyCapacity(activeTasks, {
      perceivedStressBaseline: perceivedStress.perceivedStressBaseline ?? undefined,
    });
  } catch (err) {
    console.error('recomputeCurrentWeekDerivedData: analyzeWeeklyCapacity failed:', err);
    capacity = {
      week_start: weekStart,
      total_capacity_hours: 40,
      used_capacity_hours: activeTasks.reduce((acc, t) => acc + (t.estimated_duration_hours || 1), 0),
      overload_warning: false,
      category_breakdown: {},
      stress_score: 50,
      ai_reasoning: 'Calculated from active scheduled tasks.',
    };
  }

  const capacityRecord: WeeklyCapacityAnalysis = {
    ...capacity,
    week_start: weekStart,
  };

  await saveWeeklyCapacity(capacityRecord);

  // Recompute fused stress score
  try {
    await recomputeFusedScore(capacityRecord.stress_score);
  } catch (e) {
    console.error('recomputeFusedScore error:', e);
  }

  return capacityRecord;
}

/**
 * Two-way task creation: Adds to device native calendar + persists in database + re-evaluates capacity.
 */
export async function createAndSyncTask(task: Omit<TaskAnalysis, 'id' | 'createdAt'>): Promise<string> {
  // 1. Sync to phone native calendar
  const calEventId = await addEventToDeviceCalendar({
    title: task.title,
    scheduled_date: task.scheduled_date,
    scheduled_start_time: task.scheduled_start_time,
    scheduled_end_time: task.scheduled_end_time,
  });

  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const weekStartDate = new Date(now);
  weekStartDate.setDate(diff);
  const weekStartStr = weekStartDate.toISOString().split('T')[0];

  const id = uid();
  const taskRecord: TaskAnalysis = {
    ...task,
    id,
    week_start: task.week_start || weekStartStr,
    calendar_event_id: calEventId || undefined,
    status: 'approved',
    createdAt: new Date().toISOString(),
  };

  // 2. Persist in database
  await saveTaskAnalysis(taskRecord);
  try {
    await createWorkloadItem(taskRecord);
  } catch (e) {
    // workload item insert optional
  }

  // 3. Re-evaluate all derived data
  await recomputeCurrentWeekDerivedData(taskRecord.week_start);

  return id;
}

/**
 * Two-way task deletion: Deletes from device native calendar + removes from database + re-evaluates capacity.
 */
export async function deleteAndSyncTask(taskId: string, calendarEventId?: string): Promise<void> {
  // 1. Delete from phone native calendar
  if (calendarEventId) {
    await deleteEventFromDeviceCalendar(calendarEventId);
  }

  // 2. Delete from database
  await deleteTaskAnalysis(taskId);
  if (hasSupabase) {
    await supabase.from('workload_items').delete().eq('id', taskId);
  }
  await writeDb((db) => {
    db.workloadItems = (db.workloadItems || []).filter((w) => w.id !== taskId);
  });
}

/**
 * Removes all task analyses, workload items, and capacity records that do NOT
 * belong to the given current-week start date. Keeps the database focused on
 * the active week only.
 */
export async function deleteTasksOutsideWeek(currentWeekStart: string): Promise<void> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (userId) {
      await supabase
        .from('ai_task_analysis')
        .delete()
        .eq('user_id', userId)
        .neq('week_start', currentWeekStart);
      await supabase
        .from('weekly_capacity_analyses')
        .delete()
        .eq('user_id', userId)
        .neq('week_start', currentWeekStart);
    }
  }

  await writeDb((db) => {
    db.taskAnalyses = (db.taskAnalyses || []).filter(
      (t) => t.week_start === currentWeekStart
    );
    db.weeklyCapacities = (db.weeklyCapacities || []).filter(
      (c) => c.week_start === currentWeekStart
    );
  });
}

/**
 * Syncs calendar events into the database for the active week WITHOUT running AI:
 * - Match task/calendar ID or (title + date + time) to prevent duplicate workloads
 * - New -> insert into DB as pending
 * - Unchanged -> skip
 * - Changed -> update date/time/title in DB
 */
export async function syncCalendarToDb(weekStartStr?: string): Promise<{
  tasksCreated: number;
  tasksUpdated: number;
  totalEvents: number;
}> {
  try {
    const connections = await getCalendarConnections();
    const hasConnection = connections.some((c) => c.connected);
    if (!hasConnection) return { tasksCreated: 0, tasksUpdated: 0, totalEvents: 0 };

    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const weekStartDate = new Date(now);
    weekStartDate.setDate(diff);
    const targetWeekStart = weekStartStr || weekStartDate.toISOString().split('T')[0];

    // Purge previous/next-week data so the DB only holds the current week
    await deleteTasksOutsideWeek(targetWeekStart);

    const allEvents = await syncCalendarEvents();
    if (!allEvents || allEvents.length === 0) {
      return { tasksCreated: 0, tasksUpdated: 0, totalEvents: 0 };
    }

    const existingTasks = await getTaskAnalyses(targetWeekStart);

    let created = 0;
    let updated = 0;

    for (const ev of allEvents) {
      const start = ev.startDate ? new Date(ev.startDate) : new Date();
      const end = ev.endDate ? new Date(ev.endDate) : undefined;

      const evStartDate = start.toISOString().split('T')[0];
      const evStartTime = start.toTimeString().slice(0, 5);
      const evEndTime = end ? end.toTimeString().slice(0, 5) : undefined;

      const durationHours = end
        ? Math.max(0.25, (end.getTime() - start.getTime()) / (1000 * 60 * 60))
        : 1;
;

      const existing = existingTasks.find(
        (t) =>
          (t.calendar_event_id && t.calendar_event_id === ev.id) ||
          t.id === ev.id ||
          (t.title.toLowerCase().trim() === ev.title.toLowerCase().trim() &&
            t.scheduled_date === evStartDate &&
            (t.scheduled_start_time || '') === evStartTime)
      );

      if (!existing) {
        // Insert new task without duplicates
        const newTask: TaskAnalysis = {
          id: ev.id || uid(),
          title: ev.title || 'Untitled Event',
          category: 'academic',
          priority: 'medium',
          estimated_duration_hours: durationHours,
          scheduled_date: evStartDate,
          scheduled_start_time: evStartTime,
          scheduled_end_time: evEndTime,
          capacity_hours: durationHours,
          rank: existingTasks.length + created + 1,
          stress_score: 50,
          ai_reasoning: 'Synced from device calendar.',
          status: 'pending',
          calendar_event_id: ev.id,
          calendar_provider: 'device',
          week_start: targetWeekStart,
          createdAt: new Date().toISOString(),
        };
        await saveTaskAnalysis(newTask);
        created++;
      } else {
        const isChanged =
          existing.title !== ev.title ||
          existing.scheduled_date !== evStartDate ||
          (existing.scheduled_start_time || '') !== evStartTime ||
          (existing.scheduled_end_time || '') !== (evEndTime || '');

        if (isChanged) {
          await updateTaskAnalysis(
            existing.id,
            {
              title: ev.title,
              scheduled_date: evStartDate,
              scheduled_start_time: evStartTime,
              scheduled_end_time: evEndTime,
              estimated_duration_hours: durationHours,
              calendar_event_id: ev.id,
            },
            true
          );
          updated++;
        }
      }
    }

    return {
      tasksCreated: created,
      tasksUpdated: updated,
      totalEvents: allEvents.length,
    };
  } catch (err) {
    console.error('syncCalendarToDb error:', err);
    return { tasksCreated: 0, tasksUpdated: 0, totalEvents: 0 };
  }
}

/**
 * Runs AI task analysis on the active week's tasks in the DB.
 */
export async function analyzeCurrentWeekTasks(
  weekStartStr?: string
): Promise<TaskAnalysis[]> {
  try {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const weekStartDate = new Date(now);
    weekStartDate.setDate(diff);
    const targetWeekStart = weekStartStr || weekStartDate.toISOString().split('T')[0];

    const tasks = await getTaskAnalyses(targetWeekStart);
    if (tasks.length === 0) return [];

    const eventsToAnalyze: CalendarEventItem[] = tasks.map((t) => {
      const startTime = t.scheduled_start_time || '09:00';
      const endTime = t.scheduled_end_time || '10:00';
      return {
        id: t.calendar_event_id || t.id,
        title: t.title,
        startDate: `${t.scheduled_date}T${startTime}:00`,
        endDate: `${t.scheduled_date}T${endTime}:00`,
      };
    });

    const perceivedStress = await getBaseline();
    const { analyzeCalendarTasks } = await import('@/services/aiService');
    const analyzedTasks = await analyzeCalendarTasks(eventsToAnalyze, {
      perceivedStressBaseline: perceivedStress.perceivedStressBaseline ?? undefined,
    });

    for (const t of tasks) {
      const analyzed =
        analyzedTasks.find((a) => a.id === t.calendar_event_id || a.id === t.id) ||
        analyzedTasks.find((a) => a.title.toLowerCase().trim() === t.title.toLowerCase().trim());

      if (analyzed) {
        await updateTaskAnalysis(
          t.id,
          {
            category: analyzed.category || t.category,
            priority: analyzed.priority || t.priority,
            estimated_duration_hours: analyzed.estimated_duration_hours || t.estimated_duration_hours,
            stress_score: analyzed.stress_score ?? t.stress_score,
            ai_reasoning: analyzed.ai_reasoning || t.ai_reasoning,
            rank: analyzed.rank || t.rank,
          },
          true
        );
      }
    }

    await recomputeCurrentWeekDerivedData(targetWeekStart);
    return await getTaskAnalyses(targetWeekStart);
  } catch (err) {
    console.error('analyzeCurrentWeekTasks error:', err);
    return await getTaskAnalyses(weekStartStr);
  }
}

/**
 * Syncs calendar events for the active week with differential matching:
 * - Match task/calendar ID
 * - New -> insert into DB and run AI analysis
 * - Unchanged -> skip AI analysis and skip DB update
 * - Changed -> update DB and run AI analysis
 * - AI failure/errors -> console.error()
 * - Recomputes all derived data
 */
export async function syncAndAnalyzeCalendar(): Promise<{
  tasksCreated: number;
  tasksUpdated: number;
  capacityAnalyzed: boolean;
}> {
  try {
    const syncRes = await syncCalendarToDb();
    if (syncRes.totalEvents > 0) {
      await analyzeCurrentWeekTasks();
    }
    await recomputeCurrentWeekDerivedData();
    return {
      tasksCreated: syncRes.tasksCreated,
      tasksUpdated: syncRes.tasksUpdated,
      capacityAnalyzed: true,
    };
  } catch (err) {
    console.error('syncAndAnalyzeCalendar error:', err);
    return { tasksCreated: 0, tasksUpdated: 0, capacityAnalyzed: false };
  }
}

/* ── Recovery garden: wallet & owned items ───────────────────────── */

/**
 * The user's current seed balance. Seeds are only ever positive; a deficit
 * cannot exist, so callers must spend via purchaseGardenItem which checks.
 */
export async function getGardenWallet(): Promise<GardenWallet> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) return { seeds: 0 };
    const { data } = await supabase
      .from('garden_wallet')
      .select('seeds, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    return { seeds: data?.seeds ?? 0, updatedAt: data?.updated_at ?? new Date().toISOString() };
  }
  const db = await readDb();
  return { seeds: db.gardenWallet?.seeds ?? 0, updatedAt: db.gardenWallet?.updatedAt };
}

/** Adjusts the seed balance by a signed amount, never dropping below zero. */
export async function earnSeeds(amount: number): Promise<GardenWallet> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) return { seeds: 0 };
    const current = await getGardenWallet();
    const next = Math.max(0, current.seeds + Math.round(amount));
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('garden_wallet')
      .upsert({ user_id: userId, seeds: next, updated_at: updatedAt }, { onConflict: 'user_id' });
    if (error) throw error;
    return { seeds: next, updatedAt };
  }
  let wallet: GardenWallet = { seeds: 0, updatedAt: new Date().toISOString() };
  await writeDb((db) => {
    const current = db.gardenWallet?.seeds ?? 0;
    db.gardenWallet = { seeds: Math.max(0, current + Math.round(amount)), updatedAt: new Date().toISOString() };
    wallet = db.gardenWallet;
  });
  return wallet;
}

/** What the user owns in their garden, oldest first. */
export async function getGardenItems(): Promise<GardenItem[]> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) return [];
    const { data } = await supabase
      .from('garden_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    return (data ?? []).map((r: any) => ({
      id: r.id,
      itemKey: r.item_key,
      name: r.name,
      emoji: r.emoji,
      kind: r.kind,
      placedAt: r.created_at ?? r.placed_at,
    }));
  }
  const db = await readDb();
  return db.gardenItems ?? [];
}

/** Spends seeds on a catalogue item and adds it to the garden. */
export async function purchaseGardenItem(
  item: { key: string; name: string; emoji: string; kind: 'plant' | 'flower' | 'pet' | 'decoration' },
  cost: number
): Promise<GardenItem> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) throw new Error('Sign in to grow your garden.');
    const wallet = await getGardenWallet();
    if (wallet.seeds < cost) throw new Error('Not enough seeds yet. Complete a recovery activity to earn more.');
    const { data, error } = await supabase
      .from('garden_items')
      .insert({ user_id: userId, item_key: item.key, name: item.name, emoji: item.emoji, kind: item.kind })
      .select()
      .single();
    if (error) throw error;
    await earnSeeds(-cost);
    return {
      id: data.id,
      itemKey: data.item_key,
      name: data.name,
      emoji: data.emoji,
      kind: data.kind,
      placedAt: data.created_at,
    };
  }
  let created!: GardenItem;
  const wallet = await getGardenWallet();
  if (wallet.seeds < cost) throw new Error('Not enough seeds yet. Complete a recovery activity to earn more.');
  await writeDb((db) => {
    db.gardenWallet = { seeds: db.gardenWallet.seeds - cost, updatedAt: new Date().toISOString() };
    created = {
      id: uid(),
      itemKey: item.key,
      name: item.name,
      emoji: item.emoji,
      kind: item.kind,
      placedAt: new Date().toISOString(),
    };
    db.gardenItems = [...(db.gardenItems ?? []), created];
  });
  return created;
}

/** Gives the very first starter item when the garden is empty. */
export async function ensureStarterGardenItem(): Promise<GardenItem | null> {
  if (hasSupabase) {
    const userId = await currentUserId();
    if (!userId) return null;
    const items = await getGardenItems();
    if (items.length > 0) return null;
    await earnSeeds(20);
    const { data, error } = await supabase
      .from('garden_items')
      .insert({ user_id: userId, item_key: 'starter', name: 'Your first sprout', emoji: '🌱', kind: 'plant' })
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      itemKey: data.item_key,
      name: data.name,
      emoji: data.emoji,
      kind: data.kind,
      placedAt: data.created_at,
    };
  }
  const db = await readDb();
  if ((db.gardenItems ?? []).length > 0) return null;
  await earnSeeds(20);
  let created!: GardenItem;
  await writeDb((inner) => {
    created = {
      id: uid(),
      itemKey: 'starter',
      name: 'Your first sprout',
      emoji: '🌱',
      kind: 'plant',
      placedAt: new Date().toISOString(),
    };
    inner.gardenItems = [created];
  });
  return created;
}

