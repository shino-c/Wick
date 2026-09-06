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

/** Below this, rPPG bursts are treated as unusable rather than merely noisy. */
export const MIN_BURST_SECONDS = 5;

export type SignalQuality = 'good' | 'poor';
export type StressLevel = 'Normal' | 'Elevated Stress' | 'High Stress' | 'Unknown';

export interface PPGResult {
  heartRate: number | null;
  hrvRmssd: number | null;
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
    if (rawSignal.length < fps * MIN_BURST_SECONDS) {
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

    let ibiMs: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      ibiMs.push(((peaks[i] - peaks[i - 1]) / fps) * 1000);
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

    return {
      heartRate,
      hrvRmssd: rmssd,
      heartRateCategory: hrCategory(heartRate),
      ibiList: ibiMs.map((v) => round(v, 2)),
      peakCount: peaks.length,
      signalQuality: 'good',
      filteredSignal: filtered.map((v) => round(v, 4)),
      error: null,
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
   */
  static biometricScore(deviationPct: number | null): number | null {
    if (deviationPct === null) return null;
    return Math.max(0, Math.min(100, deviationPct));
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

function poor(reason: string): PPGResult {
  return {
    heartRate: null,
    hrvRmssd: null,
    heartRateCategory: null,
    ibiList: [],
    peakCount: 0,
    signalQuality: 'poor',
    filteredSignal: [],
    error: reason,
  };
}
