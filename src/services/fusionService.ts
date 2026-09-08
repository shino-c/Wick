/**
 * Triangulated Load Score (Pillar 4 handoff).
 *
 * Design rule: the continuous fused number is the single source of truth.
 * Every label shown anywhere in the app is derived *from* that number by
 * stressBucket(), never stored alongside it — so a badge and a number can
 * never desync across screens.
 *
 * Weights are a starting point and still need agreeing with Shino, since the
 * fused Total Score is formally Pillar 4's territory. What Desk Mode hands off
 * is the continuous deviation_pct, not a pre-bucketed label.
 */

export interface Signal {
  score: number;
  ageHours: number;
}
export interface FusionInput {
  biometric?: Signal;
  selfReport?: Signal;
  load?: Signal;
}
export type Confidence = 'Low' | 'Medium' | 'High';
export interface FusionResult {
  fusedScore: number | null;
  confidence: Confidence;
  /** Std-dev between the available signals. High spread is itself an insight. */
  spread: number;
  signalsUsed: number;
  /** Plain-language read on *why* the confidence is what it is. */
  note: string;
  biometricScore: number | null;
  selfReportScore: number | null;
  loadScore: number | null;
}

export const BASE_WEIGHTS = { biometric: 0.4, selfReport: 0.3, load: 0.3 } as const;
const HALF_LIFE_HOURS = 12;

/**
 * Conversion rule 1 (Desk Mode / Biometric):
 * deviation_pct from classify_stress().
 * Clamped: clamp(deviation_pct, 0, 100).
 * Negative deviation = HRV above baseline = feeling good -> floor at 0.
 */
export function clampBiometricScore(deviationPct: number | null): number | null {
  if (deviationPct === null) return null;
  return Math.min(100, Math.max(0, Math.round(deviationPct * 10) / 10));
}

/**
 * Conversion rule 2 (Questionnaire / Self-Report):
 * self_score = (raw_sum / max_possible_sum) * 100
 */
export function convertQuestionnaireScore(rawSum: number, maxPossibleSum: number): number {
  if (maxPossibleSum <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((rawSum / maxPossibleSum) * 1000) / 10));
}

/**
 * Conversion rule 3 (Calendar/Task Load):
 * Weekly capacity % (already 0-100).
 */
export function convertLoadScore(weeklyCapacityPct: number): number {
  return Math.min(100, Math.max(0, Math.round(weeklyCapacityPct * 10) / 10));
}

export function fuseStressScore(signals: FusionInput): FusionResult {
  const entries = (Object.entries(signals) as [keyof typeof BASE_WEIGHTS, Signal | undefined][])
    .filter((e): e is [keyof typeof BASE_WEIGHTS, Signal] => e[1] !== undefined);

  const weighted = entries.map(([key, s]) => ({
    key,
    score: s.score,
    weight: BASE_WEIGHTS[key] * Math.exp(-s.ageHours / HALF_LIFE_HOURS),
  }));

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  const fusedScore =
    totalWeight === 0 ? null : weighted.reduce((sum, w) => sum + w.score * w.weight, 0) / totalWeight;

  const scores = weighted.map((w) => w.score);
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const spread = scores.length
    ? Math.sqrt(scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length)
    : 0;

  const confidence: Confidence =
    entries.length === 3 && spread < 15 ? 'High' : entries.length >= 2 && spread < 25 ? 'Medium' : 'Low';

  return {
    fusedScore: fusedScore !== null ? Math.round(fusedScore * 10) / 10 : null,
    confidence,
    spread: Math.round(spread * 10) / 10,
    signalsUsed: entries.length,
    note: explain(signals, entries.length, spread),
    biometricScore: signals.biometric?.score ?? null,
    selfReportScore: signals.selfReport?.score ?? null,
    loadScore: signals.load?.score ?? null,
  };
}

function explain(signals: FusionInput, used: number, spread: number): string {
  if (used === 0) return 'No signals yet — run a spot check or a focus session.';
  if (used === 1) return 'Only one signal type available. Add a self-report to raise confidence.';
  if (spread >= 25) {
    const bio = signals.biometric?.score ?? 0;
    const self = signals.selfReport?.score ?? 0;
    if (bio < self - 15) return "Your body reads calm, but you're reporting high strain — worth a look.";
    if (self < bio - 15) return "You're reporting fine, but your body is showing strain.";
    return 'Signals disagree — treat this number as a rough read.';
  }
  return used === 3 ? 'All three signal types agree.' : 'Two signal types agree.';
}

export type Bucket = 'Relaxed' | 'Mildly Tense' | 'Very Stressed';

export function stressBucket(score: number): Bucket {
  if (score < 30) return 'Relaxed';
  if (score < 60) return 'Mildly Tense';
  return 'Very Stressed';
}

/** Hours between an ISO timestamp and now, for the recency decay above. */
export function ageHours(iso: string): number {
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000);
}

/**
 * Pillar 4: Correlates self-reported stress against domain load to show which domain
 * is actually driving the strain, not just "life in general."
 */
export function calculateDomainDriver(
  breakdown: Record<string, { hours: number; percentage: number; name: string }>
): { domain: string; percentage: number; insight: string } {
  let maxDomain = 'Academic';
  let maxPct = 0;
  let maxHours = 0;

  for (const item of Object.values(breakdown)) {
    if (item.percentage > maxPct) {
      maxPct = item.percentage;
      maxDomain = item.name;
      maxHours = item.hours;
    }
  }

  return {
    domain: maxDomain,
    percentage: maxPct,
    insight: `${maxDomain} is driving ${maxPct}% of this week's strain (${maxHours}h scheduled).`,
  };
}
