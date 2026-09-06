/**
 * repository.ts — the one place that decides "Supabase or local demo store?".
 *
 * Screens never import supabaseClient or localStore directly; they call these
 * functions. Adding the backend later (or losing it mid-demo) changes nothing
 * above this line.
 */
import { hasSupabase, supabase, currentUserId } from '@/lib/supabaseClient';
import { readDb, uid, writeDb } from '@/data/localStore';
import type {
  AccuracyVerdict,
  Baseline,
  ChallengeRow,
  CircleSummary,
  NewChallenge,
  FocusSessionRow,
  FriendSummary,
  IncomingRequest,
  PpgScan,
  SelfReport,
  StressScoreRow,
} from '@/data/types';
import { PPGService, type PPGResult, type StressClassification } from './ppgService';
import { ageHours, fuseStressScore, type FusionResult } from './fusionService';

/**
 * Smallest circle we will aggregate. Below this, "2 of 2 friends are in the red
 * zone" is a raw individual score wearing a disguise, so we suppress instead.
 */
export const MIN_CIRCLE_SIZE = 3;

/* ── Pillar 3: baseline, scans, self-reports ──────────────────────── */

export async function getBaseline(): Promise<Baseline> {
  if (hasSupabase) {
    const userId = await currentUserId();
    const { data } = await supabase.from('baselines').select('*').eq('user_id', userId).maybeSingle();
    return {
      rmssdBaseline: data?.rmssd_baseline ?? null,
      scanCount: data?.scan_count ?? 0,
      perceivedStressBaseline: data?.perceived_stress_baseline ?? null,
      updatedAt: data?.updated_at ?? new Date().toISOString(),
    };
  }
  return (await readDb()).baseline;
}

/**
 * Persists a scan and rolls the baseline forward.
 *
 * Only scalars are written. filteredSignal and ibiList are deliberately dropped
 * here — they stay on the device for the life of the screen and are never
 * uploaded, in line with the on-device-only promise.
 */
export async function saveScan(
  result: PPGResult,
  source: 'finger' | 'face',
  classification: StressClassification
): Promise<void> {
  const row = {
    source,
    heart_rate: result.heartRate,
    hrv_rmssd: result.hrvRmssd,
    stress_level: classification.stressLevel,
    deviation_pct: classification.deviationPct,
    signal_quality: result.signalQuality,
  };

  if (hasSupabase) {
    const userId = await currentUserId();
    await supabase.from('ppg_scans').insert({ ...row, user_id: userId });
    if (result.signalQuality === 'good' && result.hrvRmssd !== null) {
      const base = await getBaseline();
      const [next, count] = PPGService.updateRmssdBaseline(
        base.rmssdBaseline,
        base.scanCount,
        result.hrvRmssd
      );
      await supabase.from('baselines').upsert({
        user_id: userId,
        rmssd_baseline: next,
        scan_count: count,
        updated_at: new Date().toISOString(),
      });
    }
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
    if (result.signalQuality === 'good' && result.hrvRmssd !== null) {
      const [next, count] = PPGService.updateRmssdBaseline(
        db.baseline.rmssdBaseline,
        db.baseline.scanCount,
        result.hrvRmssd
      );
      db.baseline.rmssdBaseline = next;
      db.baseline.scanCount = count;
      db.baseline.updatedAt = new Date().toISOString();
    }
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
    await supabase.from('baselines').upsert({
      user_id: userId,
      perceived_stress_baseline: score,
      updated_at: new Date().toISOString(),
    });
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

/* ── Fused score (handoff to Pillar 4) ───────────────────────────── */

/**
 * Recomputes the fused score from whatever signals exist and persists it.
 * `loadScore` is Pillar 1's weekly-capacity number; until that pillar lands we
 * fuse without it and confidence drops accordingly — the honest behaviour
 * rather than a placeholder value that would fake agreement.
 */
export async function recomputeFusedScore(loadScore?: number): Promise<FusionResult> {
  const [scans, self] = await Promise.all([listScans(5), latestSelfReport()]);
  const bio = scans.find((s) => s.signalQuality === 'good' && s.deviationPct !== null);

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
      joinedCount: r.joined_count,
      circleSize: r.circle_size,
      joined: r.joined,
      createdBy: r.created_by ?? null,
      createdByMe: r.created_by_me ?? false,
      notes: r.notes ?? null,
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
      p_notes: input.notes,
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
      joinedCount: 1,
      circleSize: db.friends.length + 1,
      joined: true,
      createdBy: 'me',
      createdByMe: true,
      notes: input.notes,
    });
  });
  return id;
}

export async function deleteChallenge(id: string): Promise<void> {
  if (hasSupabase) {
    const { error } = await supabase.rpc('delete_challenge', { challenge_id: id });
    if (error) throw error;
    return;
  }
  await writeDb((db) => {
    db.challenges = db.challenges.filter((c) => c.id !== id);
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
    ch.joined = !ch.joined;
    ch.joinedCount += ch.joined ? 1 : -1;
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
  return (await readDb()).friends.length;
}

/** True when at least one friend in the circle is currently flagged as overloaded. */
export async function circleNeedsSupport(): Promise<boolean> {
  const summary = await getCircleSummary();
  return !summary.suppressed && (summary.redZoneCount ?? 0) > 0;
}
