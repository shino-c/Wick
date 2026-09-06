/**
 * trendService.ts — "rising faster than usual" (Pillar 3, Trend Velocity Alert).
 *
 * The alert is defined precisely rather than as a vibes label:
 *
 *   velocity  = least-squares slope of deviation_pct over the last
 *               RECENT_WINDOW scans, expressed as %-points per day.
 *   usual     = the same slope measured over every earlier overlapping window
 *               in this user's own history — never a population norm, because
 *               HRV is only meaningful against an individual mean.
 *   alert     = velocity exceeds the 80th percentile of that personal
 *               distribution AND is positive by at least MIN_SLOPE.
 *
 * That means the alert can fire while the absolute score still looks fine,
 * which is the whole point: it catches the silent pile-up before the load
 * score itself looks alarming.
 *
 * ── Why scans are collapsed to daily means first ─────────────────────
 * Velocity is expressed per DAY, and the slope is taken over consecutive
 * readings. Desk Mode emits a reading every 15 seconds, so four consecutive
 * scans can span a single minute: a perfectly ordinary 3-point rise over 60
 * seconds becomes a slope of ~4,300 %-points per day, which beat every
 * percentile in the user's history and lit the alert permanently. Averaging to
 * one point per calendar day makes the unit mean what it says and stops a long
 * focus session from drowning out weeks of history.
 */
import type { PpgScan } from '@/data/types';

/** Days, not scans. See the note above about collapsing to daily means. */
const RECENT_WINDOW = 4;
/** Below this, a rise is inside day-to-day HRV noise and not worth flagging. */
const MIN_SLOPE_PER_DAY = 4;
/** Personal-history percentile a velocity must beat to count as "unusual". */
const PERCENTILE = 0.8;
/** Without this much personal history, we say so instead of inventing a norm. */
const MIN_HISTORY_WINDOWS = 3;

export interface TrendVelocity {
  /** %-points of HRV deviation per day. Positive = stress climbing. */
  velocityPerDay: number | null;
  /** The user's own typical climb rate, for the "vs usual" comparison. */
  usualVelocityPerDay: number | null;
  /** How much faster than usual, as a percentage. Null when incomparable. */
  surgePct: number | null;
  rising: boolean;
  alert: boolean;
  reason: string;
  /** Observed deviation series, oldest first — drives the alert card's chart. */
  series: number[];
  /** Flat-ish personal trajectory over the same span, for the dashed line. */
  expected: number[];
}

interface Point {
  t: number; // days
  v: number; // deviation_pct
}

/** Ordinary least squares slope, in units of v per unit of t. */
function slope(points: Point[]): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanV = points.reduce((s, p) => s + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.v - meanV);
    den += (p.t - meanT) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * @param scans newest-first, as returned by repository.listScans()
 */
export function computeTrendVelocity(scans: PpgScan[]): TrendVelocity {
  // One point per calendar day: the mean deviation of that day's usable scans.
  const byDay = new Map<number, { sum: number; n: number }>();
  for (const scan of scans) {
    if (scan.signalQuality !== 'good' || scan.deviationPct === null) continue;
    const day = Math.floor(new Date(scan.createdAt).getTime() / 86_400_000);
    const bucket = byDay.get(day) ?? { sum: 0, n: 0 };
    bucket.sum += scan.deviationPct;
    bucket.n += 1;
    byDay.set(day, bucket);
  }
  const usable: Point[] = [...byDay.entries()]
    .map(([day, b]) => ({ t: day, v: b.sum / b.n }))
    .sort((a, b) => a.t - b.t);

  const series = usable.slice(-12).map((p) => p.v);
  const empty = (reason: string): TrendVelocity => ({
    velocityPerDay: null,
    usualVelocityPerDay: null,
    surgePct: null,
    rising: false,
    alert: false,
    reason,
    series,
    expected: [],
  });

  if (usable.length < RECENT_WINDOW) {
    return empty(
      `${usable.length}/${RECENT_WINDOW} days of readings — a few more and Wick can spot a surge early.`
    );
  }

  const recent = usable.slice(-RECENT_WINDOW);
  const velocity = slope(recent);
  if (velocity === null) return empty('Readings are all from one day — no trend to measure yet.');

  // Every earlier overlapping window forms this user's personal slope history.
  const history: number[] = [];
  for (let end = usable.length - RECENT_WINDOW; end > 0; end--) {
    const s = slope(usable.slice(end - 1, end - 1 + RECENT_WINDOW));
    if (s !== null) history.push(s);
  }

  const meanV = recent.reduce((s, p) => s + p.v, 0) / recent.length;
  const expected = series.map(() => Math.round(meanV * 10) / 10);

  if (history.length < MIN_HISTORY_WINDOWS) {
    return {
      velocityPerDay: round(velocity),
      usualVelocityPerDay: null,
      surgePct: null,
      rising: velocity > MIN_SLOPE_PER_DAY,
      alert: false,
      reason: 'Still learning your usual rhythm — early warnings switch on after about a week of scans.',
      series,
      expected,
    };
  }

  const sorted = [...history].sort((a, b) => a - b);
  const usual = percentile(sorted, PERCENTILE);
  const typical = percentile(sorted, 0.5);
  const rising = velocity > MIN_SLOPE_PER_DAY;
  const alert = rising && velocity > usual;
  const surgePct =
    Math.abs(typical) > 0.5 ? Math.round(((velocity - typical) / Math.abs(typical)) * 100) : null;

  return {
    velocityPerDay: round(velocity),
    usualVelocityPerDay: round(typical),
    surgePct,
    rising,
    alert,
    reason: alert
      ? 'Silent cognitive pile-up detected. Your stress is climbing faster than your own 7-day trajectory — worth defusing before it peaks.'
      : rising
        ? 'Stress is drifting up, but at your normal pace. Nothing unusual yet.'
        : 'Your trajectory is flat or easing. No early warning.',
    series,
    expected,
  };
}

function round(v: number) {
  return Math.round(v * 10) / 10;
}
