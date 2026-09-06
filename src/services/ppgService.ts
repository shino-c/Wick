/**
 * PPGService — port of the validated FYP Python service.
 *
 * Pipeline (unchanged from the original):
 *   1. Detrend (subtract mean)
 *   2. Butterworth bandpass 0.7–3.5 Hz  (42–210 BPM)
 *   3. Peak detection
 *   4. Heart rate from mean inter-beat interval
 *   5. HRV — RMSSD from successive IBI differences
 *   6. Signal-quality gate (minimum peak count)
 *
 * The maths is identical for both capture modes. What differs is upstream, in
 * the frame processor: finger-PPG-with-flash samples the RED channel, face
 * rPPG samples the GREEN channel (least sensitive to skin tone and lighting).
 * See src/camera/frameSampling.ts.
 */

import { butterBandpass, filtfilt, findPeaks } from './dsp';

const LOW_HZ = 0.7; // 42 BPM
const HIGH_HZ = 3.5; // 210 BPM
const ORDER = 4;
const MIN_PEAKS = 5;

/**
 * Absolute floor for reporting a heart rate. Five beats over five seconds is
 * enough to average an interval; it is nowhere near enough for HRV.
 */
export const MIN_BURST_SECONDS = 8;

/**
 * Floor for reporting RMSSD.
 *
 * RMSSD is the standard deviation of *successive differences*, so its own
 * sampling error falls roughly as 1/sqrt(n). With ten intervals the 95%
 * interval on a 40 ms RMSSD is wider than the 10%/30% thresholds the stress
 * classifier uses — which means a short window can flip a user between Normal
 * and High Stress purely on how many beats happened to land in it. Below this
 * duration heart rate is still reported and RMSSD is returned as null, so the
 * classifier says "Unknown" instead of guessing.
 *
 * Ultra-short-term HRV work (Munoz 2015, Shaffer & Ginsberg 2017) puts usable
 * RMSSD at roughly 30s and reliable RMSSD at 60s. 30 is the compromise that
 * keeps a sliding window responsive without reporting noise.
 */
export const MIN_HRV_SECONDS = 30;

/** RMSSD also needs enough intervals, not just enough seconds. */
const MIN_IBIS_FOR_HRV = 20;

export type SignalQuality = 'good' | 'poor';
export type StressLevel = 'Normal' | 'Elevated Stress' | 'High Stress' | 'Unknown';

export interface PPGResult {
  heartRate: number | null;
  /** Null when the window was too short for RMSSD to mean anything. */
  hrvRmssd: number | null;
  /** Length of the window this reading came from, for honest UI copy. */
  hrvWindowSeconds: number;
  heartRateCategory: 'Bradycardia' | 'Normal' | 'Tachycardia' | null;
  /** Inter-beat intervals in ms. Stays on-device — never uploaded. */
  ibiList: number[];
  peakCount: number;
  signalQuality: SignalQuality;
  /** Waveform for the on-screen trace. Stays on-device — never uploaded. */
  filteredSignal: number[];
  error: string | null;
}

export interface StressClassification {
  stressLevel: StressLevel;
  deviationPct: number | null;
  message: string;
}

export class PPGService {
  /**
   * @param rawSignal mean channel intensity per frame (red for finger, green for face)
   * @param fps       measured frame rate of the burst — pass the *actual* rate,
   *                  not the requested one, or every BPM will be scaled wrong
   */
  static process(rawSignal: number[], fps: number): PPGResult {
    if (!Number.isFinite(fps) || fps <= 0) {
      return poor('Invalid frame rate');
    }
    const durationSeconds = rawSignal.length / fps;
    if (durationSeconds < MIN_BURST_SECONDS) {
      return poor(`Signal too short (< ${MIN_BURST_SECONDS}s)`);
    }

    const mean = rawSignal.reduce((a, b) => a + b, 0) / rawSignal.length;
    const detrended = rawSignal.map((v) => v - mean);

    const filtered = filtfilt(butterBandpass(ORDER, LOW_HZ, HIGH_HZ, fps), detrended);

    // 0.4 s minimum spacing => rejects anything above 150 BPM as a double-count.
    const peaks = findPeaks(filtered, Math.floor(fps * 0.4), 0.01);
    if (peaks.length < MIN_PEAKS) {
      return poor(`Too few peaks (${peaks.length}) — motion artifact likely`);
    }

    // Sub-sample peak positions. Integer peak indices quantise every beat to
    // 1/fps — 33 ms at 30fps — and RMSSD is built from the *differences*
    // between intervals, where that quantisation is the dominant error term for
    // values in the 20-50 ms range we care about. Fitting a parabola through
    // each peak and its two neighbours recovers the true maximum to a fraction
    // of a sample and cuts that error several-fold, at the cost of three
    // multiplications per beat.
    const refined = peaks.map((p) => refinePeak(filtered, p));

    let ibiMs: number[] = [];
    for (let i = 1; i < refined.length; i++) {
      ibiMs.push(((refined[i] - refined[i - 1]) / fps) * 1000);
    }
    // Drop physiologically implausible intervals.
    ibiMs = ibiMs.filter((v) => v > 300 && v < 2000);
    if (ibiMs.length < 3) {
      return poor('Insufficient valid IBIs after filtering');
    }

    const meanIbi = ibiMs.reduce((a, b) => a + b, 0) / ibiMs.length;
    const heartRate = round(60_000 / meanIbi, 1);

    const diffs = ibiMs.slice(1).map((v, i) => v - ibiMs[i]);
    const rmssd = round(Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length), 2);

    // Heart rate survives a short window; RMSSD does not. Saying so is the
    // whole point — a null here makes the classifier report "Unknown" rather
    // than turn sampling noise into a stress level.
    const hrvUsable = durationSeconds >= MIN_HRV_SECONDS && ibiMs.length >= MIN_IBIS_FOR_HRV;

    return {
      heartRate,
      hrvRmssd: hrvUsable ? rmssd : null,
      hrvWindowSeconds: Math.round(durationSeconds),
      heartRateCategory: hrCategory(heartRate),
      ibiList: ibiMs.map((v) => round(v, 2)),
      peakCount: peaks.length,
      signalQuality: 'good',
      filteredSignal: filtered.map((v) => round(v, 4)),
      error: hrvUsable
        ? null
        : `Heart rate only — HRV needs ${MIN_HRV_SECONDS}s of clean signal (had ${Math.round(durationSeconds)}s, ${ibiMs.length} intervals)`,
    };
  }

  /**
   * Rule-based stress classification relative to the user's *own* baseline.
   * Ref: Plews et al. (2013) — HRV is only meaningful against an individual mean.
   * Thresholds (FYP Table 2.2): ≤10% Normal, 10–30% Elevated, >30% High.
   */
  static classifyStress(currentRmssd: number, baselineRmssd: number | null): StressClassification {
    if (baselineRmssd === null || baselineRmssd <= 0) {
      return {
        stressLevel: 'Unknown',
        deviationPct: null,
        message: 'Baseline not yet established (need ≥ 3 scans)',
      };
    }
    const deviationPct = ((baselineRmssd - currentRmssd) / baselineRmssd) * 100;

    if (deviationPct <= 10) {
      return {
        stressLevel: 'Normal',
        deviationPct: round(deviationPct, 2),
        message: 'Your HRV is within normal range — autonomic system in balance.',
      };
    }
    if (deviationPct <= 30) {
      return {
        stressLevel: 'Elevated Stress',
        deviationPct: round(deviationPct, 2),
        message: 'Sympathetic activity is elevated. Consider rest or breathing exercises.',
      };
    }
    return {
      stressLevel: 'High Stress',
      deviationPct: round(deviationPct, 2),
      message: 'Significant parasympathetic withdrawal detected. Rest is strongly recommended.',
    };
  }

  /** Cumulative moving average. Stress classification stays off until count ≥ 3. */
  static updateRmssdBaseline(
    existingBaseline: number | null,
    existingCount: number,
    newRmssd: number
  ): [number, number] {
    const count = existingCount + 1;
    if (existingBaseline === null || existingCount === 0) return [round(newRmssd, 2), count];
    return [round((existingBaseline * existingCount + newRmssd) / count, 2), count];
  }

  /**
   * Biometric contribution to the fused dashboard score, on the shared 0–100
   * scale. Pillar 4 receives the continuous number, never a bucketed label.
   *
   * This is NOT the raw deviation percentage, which is what it used to return.
   * The two scales have different breakpoints, and passing one through as the
   * other made the app contradict itself: a 32% deviation is "High Stress" by
   * the Plews thresholds, but 32 on the fused scale is "Mildly Tense", so the
   * spot-check screen and the dashboard reported different verdicts on the same
   * measurement.
   *
   * The mapping is piecewise linear through the shared bucket boundaries:
   *
   *    deviation   0% → 0     (baseline or better)
   *               10% → 30    Normal / Elevated boundary  = Relaxed / Mildly Tense
   *               30% → 60    Elevated / High boundary    = Mildly Tense / Very Stressed
   *               60% → 100   floor of the HRV range worth distinguishing
   */
  static biometricScore(deviationPct: number | null): number | null {
    if (deviationPct === null) return null;
    const d = Math.max(0, deviationPct);
    if (d <= 10) return round((d / 10) * 30, 1);
    if (d <= 30) return round(30 + ((d - 10) / 20) * 30, 1);
    return round(Math.min(100, 60 + ((d - 30) / 30) * 40), 1);
  }
}

export const BASELINE_MIN_SCANS = 3;

function round(v: number, dp: number) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function hrCategory(bpm: number): 'Bradycardia' | 'Normal' | 'Tachycardia' {
  if (bpm < 60) return 'Bradycardia';
  if (bpm > 100) return 'Tachycardia';
  return 'Normal';
}

/**
 * Quadratic (parabolic) interpolation of a discrete maximum.
 *
 * Given y(-1), y(0), y(1) around an integer peak, the vertex of the parabola
 * through them sits at 0.5*(y(-1) - y(1)) / (y(-1) - 2y(0) + y(1)) samples from
 * the centre. Standard practice in spectral peak picking; here it is applied in
 * the time domain to beat locations.
 */
function refinePeak(x: number[], i: number): number {
  if (i <= 0 || i >= x.length - 1) return i;
  const a = x[i - 1];
  const b = x[i];
  const c = x[i + 1];
  const denom = a - 2 * b + c;
  if (denom === 0) return i;
  const delta = (0.5 * (a - c)) / denom;
  // A parabola fitted to noise can put the vertex anywhere; a true maximum's
  // vertex is always within half a sample of the centre.
  return Math.abs(delta) > 0.5 ? i : i + delta;
}

function poor(reason: string): PPGResult {
  return {
    heartRate: null,
    hrvRmssd: null,
    hrvWindowSeconds: 0,
    heartRateCategory: null,
    ibiList: [],
    peakCount: 0,
    signalQuality: 'poor',
    filteredSignal: [],
    error: reason,
  };
}
