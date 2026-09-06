/**
 * useDeskSession — the Desk Mode engine (Pillar 2).
 *
 * Responsibilities:
 *   • 3-second setup check before the timer starts
 *   • interval-sampled face rPPG bursts (camera off in between)
 *   • adaptive Pomodoro — break timing moves with the stress trend
 *   • threshold escalation — two consecutive good High Stress reads lock the
 *     timer and force a guided breathing pause
 *   • session summary for the post-session calibration prompt
 *
 * Nothing about a frame survives a burst. Each burst reduces ~360 frames to one
 * {heart rate, HRV, deviation} triple; the frames themselves were already
 * reduced to a single number each inside the frame processor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ESCALATION_CONSECUTIVE_READS, FACE, POMODORO, SETUP_CHECK_SECONDS } from './config';
import { checkFaceFraming, type FrameSample, type FramingIssue } from './frameSampling';
import { cameraAvailable, requestCameraPermission, type FaceBox } from './CaptureCamera';
import { rampedProfile, simulateBurst } from './simulator';
import { PPGService, type StressLevel } from '@/services/ppgService';
import { getBaseline } from '@/services/repository';

export type SessionPhase =
  | 'idle'
  | 'permission_denied'
  | 'setup'
  | 'focus'
  | 'break'
  | 'enforced'
  | 'ended';

export interface Reading {
  at: number;
  heartRate: number | null;
  hrvRmssd: number | null;
  deviationPct: number | null;
  level: StressLevel;
  quality: 'good' | 'poor';
  /**
   * Fraction of the burst spent moving, 0–1. Derived from large excursions in
   * the ROI mean: when the head shifts, the sampled patch slides off skin and
   * the mean jumps far more than a heartbeat ever does. This is the "fidgeting
   * frequency" secondary cue. Posture angle and jaw tension would need a real
   * pose/landmark model and are deliberately not faked here.
   */
  movementIndex: number;
}

export interface DeskSessionState {
  phase: SessionPhase;
  /** Seconds remaining in the current focus block or break. */
  secondsLeft: number;
  /** Total focus seconds elapsed this session. */
  elapsedSeconds: number;
  /** Current focus block length in seconds — moves with the stress trend. */
  blockSeconds: number;
  setupIssue: FramingIssue;
  setupSecondsLeft: number;
  /** Live face boxes, for the cropped preview and the framing indicator. */
  faces: FaceBox[];
  /** Why the last burst was thrown away, if it was. */
  lastDiscardReason: string | null;
  /** True while a burst is running: camera on, indicator lit. */
  sampling: boolean;
  readings: Reading[];
  latest: Reading | null;
  breaksTaken: number;
  enforcedBreaks: number;
  /** Why the timer locked, shown on the enforced-pause screen. */
  escalationReason: string | null;
  baselineReady: boolean;
  simulated: boolean;
}

export interface SessionSummary {
  startedAt: string;
  endedAt: string;
  plannedMinutes: number;
  actualMinutes: number;
  breaksTaken: number;
  enforcedBreaks: number;
  stressDeltaPct: number | null;
  readings: Reading[];
  enforcedAtIndex: number | null;
}

export interface DeskSessionOptions {
  plannedMinutes?: number;
  /** User-chosen break length. The adaptive logic moves *when*, never how long. */
  breakMinutes?: number;
  /** Shorten the sampling cadence for a live demo. Real cadence is 3 minutes. */
  demoMode?: boolean;
  /** Simulation only: 'ramp' walks stress upward so escalation is demonstrable. */
  simArc?: 'steady' | 'ramp';
}

export function useDeskSession(options: DeskSessionOptions = {}) {
  const {
    plannedMinutes = POMODORO.DEFAULT_MINUTES,
    breakMinutes = POMODORO.DEFAULT_BREAK_MINUTES,
    demoMode = false,
    simArc = 'ramp',
  } = options;

  const burstInterval = demoMode ? 20 : FACE.BURST_INTERVAL_SECONDS;
  const burstLength = demoMode ? 6 : FACE.BURST_SECONDS;

  const [state, setState] = useState<DeskSessionState>(() => ({
    phase: 'idle',
    secondsLeft: plannedMinutes * 60,
    elapsedSeconds: 0,
    blockSeconds: plannedMinutes * 60,
    setupIssue: null,
    setupSecondsLeft: SETUP_CHECK_SECONDS,
    faces: [],
    lastDiscardReason: null,
    sampling: false,
    readings: [],
    latest: null,
    breaksTaken: 0,
    enforcedBreaks: 0,
    escalationReason: null,
    baselineReady: false,
    simulated: !cameraAvailable,
  }));

  const phaseRef = useRef<SessionPhase>('idle');
  const startedAt = useRef<string>('');
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const burstSamples = useRef<number[]>([]);
  const burstStart = useRef<number>(0);
  const setupSamples = useRef<FrameSample[]>([]);
  const setupStart = useRef<number>(0);
  const secondsUntilBurst = useRef<number>(burstInterval);
  const burstIndex = useRef<number>(0);
  const baselineRmssd = useRef<number | null>(null);
  const consecutiveHigh = useRef<number>(0);
  const enforcedAtIndex = useRef<number | null>(null);
  const enforcedLeft = useRef<number>(0);
  const facesRef = useRef<FaceBox[]>([]);
  const burstFaceFrames = useRef<number>(0);
  const burstTotalFrames = useRef<number>(0);

  const stop = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  };
  useEffect(() => () => stop(), []);

  const setPhase = (phase: SessionPhase, extra: Partial<DeskSessionState> = {}) => {
    phaseRef.current = phase;
    setState((s) => ({ ...s, phase, ...extra }));
  };

  /* ── burst handling ─────────────────────────────────────────────── */

  /**
   * Throws a burst away without producing a reading.
   *
   * This matters more than it looks. Sensor noise off any surface, once it has
   * been through a 0.7–3.5 Hz bandpass, contains oscillations that peak
   * detection will happily turn into a heart rate. Without this gate the app
   * reports a pulse for an empty chair. Silence is the correct output.
   */
  const discardBurst = useCallback((reason: string) => {
    setState((s) => ({ ...s, sampling: false, lastDiscardReason: reason }));
  }, []);

  const ingestReading = useCallback((rawSignal: number[], fps: number) => {
    const result = PPGService.process(rawSignal, fps);
    const movement = movementIndex(rawSignal);
    const classification = PPGService.classifyStress(result.hrvRmssd ?? 0, baselineRmssd.current);

    const reading: Reading = {
      at: Date.now(),
      heartRate: result.heartRate,
      hrvRmssd: result.hrvRmssd,
      deviationPct: result.signalQuality === 'good' ? classification.deviationPct : null,
      level: result.signalQuality === 'good' ? classification.stressLevel : 'Unknown',
      quality: result.signalQuality,
      movementIndex: movement,
    };

    // Escalation counts only good-quality High Stress reads. A poor read resets
    // nothing (noise shouldn't clear a genuine streak) but never advances it.
    if (reading.quality === 'good') {
      if (reading.level === 'High Stress') consecutiveHigh.current += 1;
      else consecutiveHigh.current = 0;
    }

    setState((s) => {
      const readings = [...s.readings, reading];
      const next: Partial<DeskSessionState> = { readings, latest: reading, sampling: false };

      // Adaptive Pomodoro: pull the break earlier when strain is rising, push it
      // out when the read is calm — bounded so it never becomes absurd.
      if (reading.quality === 'good' && phaseRef.current === 'focus') {
        const delta =
          reading.level === 'High Stress' ? -300 : reading.level === 'Elevated Stress' ? -180 : 120;
        const block = clamp(
          s.blockSeconds + delta,
          POMODORO.MIN_MINUTES * 60,
          POMODORO.MAX_MINUTES * 60
        );
        next.blockSeconds = block;
        next.secondsLeft = clamp(block - s.elapsedSeconds, 0, block);
      }
      return { ...s, ...next };
    });

    // Enforced pause. Deliberately not a dismissible notification.
    if (
      consecutiveHigh.current >= ESCALATION_CONSECUTIVE_READS &&
      phaseRef.current === 'focus'
    ) {
      consecutiveHigh.current = 0;
      enforcedLeft.current = POMODORO.ENFORCED_BREAK_SECONDS;
      setState((s) => {
        enforcedAtIndex.current = s.readings.length - 1;
        return {
          ...s,
          phase: 'enforced',
          enforcedBreaks: s.enforcedBreaks + 1,
          secondsLeft: POMODORO.ENFORCED_BREAK_SECONDS,
          escalationReason: `Two consecutive readings showed sustained high stress (HRV ${Math.round(
            reading.deviationPct ?? 0
          )}% below your baseline). Wick paused the timer.`,
        };
      });
      phaseRef.current = 'enforced';
    }
  }, []);

  const runSimulatedBurst = useCallback(() => {
    setState((s) => ({ ...s, sampling: true }));
    const idx = burstIndex.current++;
    setTimeout(() => {
      const profile = rampedProfile(idx, simArc);
      ingestReading(simulateBurst(profile, FACE.BURST_SECONDS, 30), 30);
    }, Math.min(burstLength, 3) * 1000);
  }, [burstLength, ingestReading, simArc]);

  const beginBurst = useCallback(() => {
    if (!cameraAvailable) {
      runSimulatedBurst();
      return;
    }
    burstSamples.current = [];
    burstStart.current = Date.now();
    burstFaceFrames.current = 0;
    burstTotalFrames.current = 0;
    setState((s) => ({ ...s, sampling: true, lastDiscardReason: null }));
  }, [runSimulatedBurst]);

  /* ── per-frame callback (setup check + bursts) ──────────────────── */

  const onSample = useCallback(
    (sample: FrameSample) => {
      const phase = phaseRef.current;

      if (phase === 'setup') {
        setupSamples.current.push(sample);
        const elapsed = (Date.now() - setupStart.current) / 1000;
        // Lighting alone is not framing. A wall at a reasonable brightness used
        // to pass this check; now the face detector has to see exactly one
        // person before the countdown is allowed to run down.
        const issue = checkFaceFraming(setupSamples.current.slice(-45), facesRef.current.length);
        setState((s) => ({
          ...s,
          setupIssue: issue,
          setupSecondsLeft: Math.max(0, Math.ceil(SETUP_CHECK_SECONDS - elapsed)),
        }));
        if (issue) {
          // Restart the countdown: three *consecutive* good seconds, not three
          // seconds containing a good moment.
          setupStart.current = Date.now();
          setupSamples.current = setupSamples.current.slice(-15);
        }
        return;
      }

      if (!burstStart.current) return;
      burstSamples.current.push(sample.mean);
      burstTotalFrames.current += 1;
      if (facesRef.current.length === 1) burstFaceFrames.current += 1;

      const elapsed = (Date.now() - burstStart.current) / 1000;
      if (elapsed >= burstLength) {
        const fps = burstSamples.current.length / elapsed;
        const raw = [...burstSamples.current];
        const faceFrames = burstFaceFrames.current;
        const totalFrames = burstTotalFrames.current;
        burstSamples.current = [];
        burstStart.current = 0;
        burstFaceFrames.current = 0;
        burstTotalFrames.current = 0;
        burstIndex.current += 1;

        const coverage = totalFrames > 0 ? faceFrames / totalFrames : 0;
        if (coverage < FACE.MIN_FACE_COVERAGE) {
          discardBurst(
            coverage === 0
              ? 'No face in frame — reading discarded'
              : 'You moved out of frame — reading discarded'
          );
          return;
        }
        ingestReading(raw, fps);
      }
    },
    [burstLength, ingestReading]
  );

  /**
   * Face detector callback. A second face means someone is behind you: the
   * burst is dropped rather than silently averaging two people's skin tones.
   */
  const onFaces = useCallback(
    (faces: FaceBox[]) => {
      facesRef.current = faces;
      setState((s) => (sameBoxes(s.faces, faces) ? s : { ...s, faces }));
      if (faces.length > 1 && burstStart.current) {
        burstSamples.current = [];
        burstStart.current = 0;
        burstFaceFrames.current = 0;
        burstTotalFrames.current = 0;
        discardBurst('Someone else came into frame — reading discarded');
      }
    },
    [discardBurst]
  );

  /* ── the clock ──────────────────────────────────────────────────── */

  const startClock = useCallback(() => {
    stop();
    tick.current = setInterval(() => {
      const phase = phaseRef.current;

      if (phase === 'setup') {
        if (!cameraAvailable) {
          const elapsed = (Date.now() - setupStart.current) / 1000;
          const left = Math.max(0, Math.ceil(SETUP_CHECK_SECONDS - elapsed));
          setState((s) => ({ ...s, setupSecondsLeft: left }));
          if (left === 0) {
            phaseRef.current = 'focus';
            secondsUntilBurst.current = Math.min(burstInterval, 5);
            setState((s) => ({ ...s, phase: 'focus' }));
          }
          return;
        }
        // Real camera: the countdown is driven by onSample, which resets it on
        // bad framing. Reaching zero there means three clean consecutive seconds.
        setState((s) => {
          if (s.setupSecondsLeft === 0 && s.phase === 'setup') {
            phaseRef.current = 'focus';
            secondsUntilBurst.current = Math.min(burstInterval, 10);
            return { ...s, phase: 'focus' };
          }
          return s;
        });
        return;
      }

      if (phase === 'enforced') {
        enforcedLeft.current -= 1;
        const left = Math.max(0, enforcedLeft.current);
        setState((s) => ({ ...s, secondsLeft: left }));
        if (left === 0) {
          phaseRef.current = 'focus';
          setState((s) => ({
            ...s,
            phase: 'focus',
            breaksTaken: s.breaksTaken + 1,
            secondsLeft: clamp(s.blockSeconds - s.elapsedSeconds, 60, s.blockSeconds),
          }));
        }
        return;
      }

      if (phase === 'break') {
        setState((s) => {
          const left = s.secondsLeft - 1;
          if (left > 0) return { ...s, secondsLeft: left };
          phaseRef.current = 'focus';
          return {
            ...s,
            phase: 'focus',
            elapsedSeconds: 0,
            secondsLeft: s.blockSeconds,
            breaksTaken: s.breaksTaken + 1,
          };
        });
        return;
      }

      if (phase !== 'focus') return;

      // Focus tick.
      secondsUntilBurst.current -= 1;
      if (secondsUntilBurst.current <= 0) {
        secondsUntilBurst.current = burstInterval;
        beginBurst();
      }

      setState((s) => {
        const elapsedSeconds = s.elapsedSeconds + 1;
        const left = Math.max(0, s.blockSeconds - elapsedSeconds);
        if (left === 0) {
          phaseRef.current = 'break';
          return {
            ...s,
            phase: 'break',
            elapsedSeconds,
            secondsLeft: breakMinutes * 60,
          };
        }
        return { ...s, elapsedSeconds, secondsLeft: left };
      });
    }, 1000);
  }, [beginBurst, burstInterval]);

  /* ── public controls ────────────────────────────────────────────── */

  const start = useCallback(async () => {
    const baseline = await getBaseline();
    baselineRmssd.current = baseline.scanCount >= 3 ? baseline.rmssdBaseline : null;

    if (cameraAvailable) {
      const granted = await requestCameraPermission();
      if (!granted) {
        setPhase('permission_denied');
        return;
      }
    }

    startedAt.current = new Date().toISOString();
    setupSamples.current = [];
    setupStart.current = Date.now();
    burstIndex.current = 0;
    consecutiveHigh.current = 0;
    enforcedAtIndex.current = null;
    secondsUntilBurst.current = burstInterval;

    setState((s) => ({
      ...s,
      phase: 'setup',
      setupIssue: null,
      setupSecondsLeft: SETUP_CHECK_SECONDS,
      secondsLeft: plannedMinutes * 60,
      blockSeconds: plannedMinutes * 60,
      elapsedSeconds: 0,
      readings: [],
      latest: null,
      breaksTaken: 0,
      enforcedBreaks: 0,
      escalationReason: null,
      baselineReady: baselineRmssd.current !== null,
      simulated: !cameraAvailable,
    }));
    phaseRef.current = 'setup';
    startClock();
  }, [burstInterval, plannedMinutes, startClock]);

  const end = useCallback((): SessionSummary => {
    stop();
    phaseRef.current = 'ended';
    const readings = state.readings;
    const good = readings.filter((r) => r.deviationPct !== null);
    const delta =
      good.length >= 2 ? (good[good.length - 1].deviationPct! - good[0].deviationPct!) : null;

    setState((s) => ({ ...s, phase: 'ended', sampling: false }));

    return {
      startedAt: startedAt.current || new Date().toISOString(),
      endedAt: new Date().toISOString(),
      plannedMinutes,
      actualMinutes: Math.round(
        (Date.now() - new Date(startedAt.current || Date.now()).getTime()) / 60000
      ),
      breaksTaken: state.breaksTaken,
      enforcedBreaks: state.enforcedBreaks,
      stressDeltaPct: delta === null ? null : Math.round(delta * 10) / 10,
      readings,
      enforcedAtIndex: enforcedAtIndex.current,
    };
  }, [plannedMinutes, state.breaksTaken, state.enforcedBreaks, state.readings]);

  /** Skip the remaining enforced pause is intentionally NOT offered. */
  const takeBreakNow = useCallback(() => {
    if (phaseRef.current !== 'focus') return;
    phaseRef.current = 'break';
    setState((s) => ({ ...s, phase: 'break', secondsLeft: breakMinutes * 60 }));
  }, [breakMinutes]);

  /** Camera should be live during the setup check and during bursts only. */
  const cameraActive = useMemo(
    () => state.phase === 'setup' || state.sampling,
    [state.phase, state.sampling]
  );

  /** Stress curve for the trend chart: deviation %, good reads only. */
  const curve = useMemo(
    () => state.readings.filter((r) => r.deviationPct !== null).map((r) => r.deviationPct as number),
    [state.readings]
  );

  /** Largest detected face — what the cropped preview centres on. */
  const primaryFace = useMemo(
    () =>
      state.faces.length === 0
        ? null
        : state.faces.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0],
    [state.faces]
  );

  return {
    ...state,
    start,
    end,
    takeBreakNow,
    onSample,
    onFaces,
    cameraActive,
    curve,
    burstInterval,
    primaryFace,
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Cheap identity check so face updates don't re-render on sub-pixel jitter. */
function sameBoxes(a: FaceBox[], b: FaceBox[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((box, i) => Math.abs(box.x - b[i].x) < 0.01 && Math.abs(box.y - b[i].y) < 0.01);
}

/** See Reading.movementIndex. Excursion threshold is in 0–255 channel units. */
function movementIndex(raw: number[]): number {
  if (raw.length < 4) return 0;
  const sorted = [...raw].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const moved = raw.filter((v) => Math.abs(v - median) > 8).length;
  return Math.round((moved / raw.length) * 100) / 100;
}
