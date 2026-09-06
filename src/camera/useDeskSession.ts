/**
 * useDeskSession — the Desk Mode engine (Pillar 2).
 *
 * Responsibilities:
 *   • 3-second setup check before the timer starts
 *   • face rPPG sampling, continuous or duty-cycled (see SENSING in config.ts)
 *   • adaptive Pomodoro — break timing moves with the stress trend
 *   • threshold escalation — two consecutive good High Stress reads lock the
 *     timer and force a guided breathing pause
 *   • session summary for the post-session calibration prompt
 *
 * ── Continuous by default ───────────────────────────────────────────
 * The first version opened the camera for 12s a minute. Two things were wrong
 * with that, and neither was fixable by tuning the duty cycle:
 *
 *   • 12s yields ~11-14 inter-beat intervals, far too few for RMSSD to be
 *     stable. The classifier was reading sampling noise as stress.
 *   • Restlessness observed 20% of the time is a coin flip. Someone fidgeting
 *     constantly who happened to be still during the burst read as "steady",
 *     and nothing in the design would ever have shown that up.
 *
 * Continuous mode keeps the camera open across the focus block and analyses a
 * sliding 40-second window every 15 seconds. Readings overlap, so the trend is
 * a curve rather than a scatter, and movement is observed for the whole block.
 *
 * Nothing about a frame survives. Each frame was already reduced to a single
 * number inside the frame processor; the rolling buffer holds at most
 * ANALYSIS_WINDOW_SECONDS of those numbers and is discarded as it ages out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ESCALATION_CONSECUTIVE_READS,
  FACE,
  POMODORO,
  SENSING,
  SETUP_CHECK_SECONDS,
  type SensingMode,
} from './config';
import {
  checkFaceFraming,
  facePresent,
  SKIN_PRESENCE_THRESHOLD,
  type FrameSample,
  type FramingIssue,
} from './frameSampling';
import {
  cameraAvailable,
  faceDetectionAvailable,
  requestCameraPermission,
  type FaceBox,
} from './CaptureCamera';
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
  /** Null when the window was too short for RMSSD to be meaningful. */
  hrvRmssd: number | null;
  deviationPct: number | null;
  level: StressLevel;
  quality: 'good' | 'poor';
  /** Seconds of signal this reading was computed from. */
  windowSeconds: number;
  /**
   * Fraction of the analysis window spent moving, 0–1. Derived from large
   * excursions in the ROI mean: when the head shifts, the sampled patch slides
   * off skin and the mean jumps far more than a heartbeat ever does.
   *
   * In continuous mode this is a genuine measurement of the whole window. In
   * saver mode it describes only the sampled slice, which is why the UI labels
   * it differently there. Posture angle and jaw tension would need a real
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
  /** Live face boxes. Populated on iOS only; empty elsewhere. */
  faces: FaceBox[];
  /** Whether a person appears to be in front of the camera right now. */
  present: boolean;
  /** Why the last window was thrown away, if it was. */
  lastDiscardReason: string | null;
  /** True while the camera is reading. Continuous for the whole block by default. */
  sampling: boolean;
  /**
   * Restlessness over the last few seconds, 0–1, updated live rather than once
   * per reading. This is the fidget cue the interval design could not see.
   */
  movementLive: number;
  /** Fraction of the focus block so far spent restless. Continuous mode only. */
  movementSessionPct: number | null;
  readings: Reading[];
  latest: Reading | null;
  breaksTaken: number;
  enforcedBreaks: number;
  /** Why the timer locked, shown on the enforced-pause screen. */
  escalationReason: string | null;
  baselineReady: boolean;
  simulated: boolean;
  /** Seconds until the next reading lands, for the UI countdown. */
  secondsToNextReading: number;
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
  /** Windows thrown away for no face / two faces. Not the same as poor signal. */
  discardedWindows: number;
  movementSessionPct: number | null;
  sensingMode: SensingMode;
  /** Filled in by the screen — the hook has no opinion about audio. */
  soundscape: string | null;
}

export interface DeskSessionOptions {
  plannedMinutes?: number;
  /** User-chosen break length. The adaptive logic moves *when*, never how long. */
  breakMinutes?: number;
  /** How the camera is scheduled. See SENSING in config.ts. */
  mode?: SensingMode;
  /** Simulation only: 'ramp' walks stress upward so escalation is demonstrable. */
  simArc?: 'steady' | 'ramp';
}

/** Timing for a sensing mode, resolved once. */
function schedule(mode: SensingMode) {
  if (mode === 'demo') {
    return {
      continuous: true,
      windowSeconds: SENSING.DEMO_WINDOW_SECONDS,
      strideSeconds: SENSING.DEMO_STRIDE_SECONDS,
      dutyIntervalSeconds: 0,
    };
  }
  if (mode === 'saver') {
    return {
      continuous: false,
      windowSeconds: SENSING.SAVER_WINDOW_SECONDS,
      strideSeconds: SENSING.SAVER_INTERVAL_SECONDS,
      dutyIntervalSeconds: SENSING.SAVER_INTERVAL_SECONDS,
    };
  }
  return {
    continuous: true,
    windowSeconds: SENSING.ANALYSIS_WINDOW_SECONDS,
    strideSeconds: SENSING.ANALYSIS_STRIDE_SECONDS,
    dutyIntervalSeconds: 0,
  };
}

interface Sample {
  v: number;
  t: number;
  present: boolean;
}

export function useDeskSession(options: DeskSessionOptions = {}) {
  const {
    plannedMinutes = POMODORO.DEFAULT_MINUTES,
    breakMinutes = POMODORO.DEFAULT_BREAK_MINUTES,
    mode = 'continuous',
    simArc = 'ramp',
  } = options;

  const timing = useMemo(() => schedule(mode), [mode]);

  const [state, setState] = useState<DeskSessionState>(() => ({
    phase: 'idle',
    secondsLeft: plannedMinutes * 60,
    elapsedSeconds: 0,
    blockSeconds: plannedMinutes * 60,
    setupIssue: null,
    setupSecondsLeft: SETUP_CHECK_SECONDS,
    faces: [],
    present: false,
    lastDiscardReason: null,
    sampling: false,
    movementLive: 0,
    movementSessionPct: null,
    readings: [],
    latest: null,
    breaksTaken: 0,
    enforcedBreaks: 0,
    escalationReason: null,
    baselineReady: false,
    simulated: !cameraAvailable,
    secondsToNextReading: timing.windowSeconds,
  }));

  const phaseRef = useRef<SessionPhase>('idle');
  const startedAt = useRef<string>('');
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Rolling analysis buffer. Never longer than the analysis window. */
  const buffer = useRef<Sample[]>([]);
  /** When the current continuous run of sampling began. */
  const samplingSince = useRef<number>(0);
  const lastEmit = useRef<number>(0);
  /** Saver mode only: seconds until the camera wakes again. */
  const secondsUntilWake = useRef<number>(0);

  const setupSamples = useRef<FrameSample[]>([]);
  const setupStart = useRef<number>(0);
  const burstIndex = useRef<number>(0);
  const baselineRmssd = useRef<number | null>(null);
  const consecutiveHigh = useRef<number>(0);
  const enforcedAtIndex = useRef<number | null>(null);
  const enforcedLeft = useRef<number>(0);
  const facesRef = useRef<FaceBox[]>([]);
  const discarded = useRef<number>(0);
  /** Whole-session movement tally, one entry per second of focus. */
  const movementTally = useRef<{ moving: number; total: number }>({ moving: 0, total: 0 });

  const stop = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  };
  useEffect(() => () => stop(), []);

  const setPhase = (phase: SessionPhase, extra: Partial<DeskSessionState> = {}) => {
    phaseRef.current = phase;
    setState((s) => ({ ...s, phase, ...extra }));
  };

  const resetBuffer = () => {
    buffer.current = [];
    samplingSince.current = Date.now();
    lastEmit.current = Date.now();
  };

  /* ── window handling ────────────────────────────────────────────── */

  /**
   * Throws a window away without producing a reading.
   *
   * This matters more than it looks. Sensor noise off any surface, once it has
   * been through a 0.7–3.5 Hz bandpass, contains oscillations that peak
   * detection will happily turn into a heart rate. Without this gate the app
   * reports a pulse for an empty chair. Silence is the correct output.
   */
  const discardWindow = useCallback((reason: string) => {
    discarded.current += 1;
    setState((s) => ({ ...s, lastDiscardReason: reason }));
  }, []);

  const ingestReading = useCallback(
    (rawSignal: number[], fps: number, movement: number) => {
      const result = PPGService.process(rawSignal, fps);
      // A null RMSSD is not an error — it means the window was honest about
      // being too short. Either way there is nothing to classify against.
      const classification =
        result.hrvRmssd === null
          ? { stressLevel: 'Unknown' as StressLevel, deviationPct: null, message: '' }
          : PPGService.classifyStress(result.hrvRmssd, baselineRmssd.current);

      const usable = result.signalQuality === 'good' && result.hrvRmssd !== null;

      const reading: Reading = {
        at: Date.now(),
        heartRate: result.heartRate,
        hrvRmssd: result.hrvRmssd,
        deviationPct: usable ? classification.deviationPct : null,
        level: usable ? classification.stressLevel : 'Unknown',
        quality: result.signalQuality,
        windowSeconds: result.hrvWindowSeconds,
        movementIndex: movement,
      };

      // Escalation counts only classifiable High Stress reads. A poor read
      // resets nothing (noise shouldn't clear a genuine streak) but never
      // advances it either.
      if (usable) {
        if (reading.level === 'High Stress') consecutiveHigh.current += 1;
        else consecutiveHigh.current = 0;
      }

      setState((s) => {
        const readings = [...s.readings, reading];
        const next: Partial<DeskSessionState> = { readings, latest: reading };

        // Adaptive Pomodoro: pull the break earlier when strain is rising, push
        // it out when the read is calm — bounded so it never becomes absurd.
        //
        // The step is scaled by how often readings arrive. At the old one-a-
        // minute cadence a 300s cut was one decisive move; at one every 15s the
        // same step would collapse a 25-minute block to the floor inside two
        // minutes. Per-minute-of-evidence keeps the behaviour identical whatever
        // the sensing mode.
        if (usable && phaseRef.current === 'focus') {
          const perMinute =
            reading.level === 'High Stress' ? -300 : reading.level === 'Elevated Stress' ? -180 : 120;
          const delta = (perMinute * timing.strideSeconds) / 60;
          const block = clamp(
            s.blockSeconds + delta,
            POMODORO.MIN_MINUTES * 60,
            POMODORO.MAX_MINUTES * 60
          );
          next.blockSeconds = Math.round(block);
          next.secondsLeft = Math.round(clamp(block - s.elapsedSeconds, 0, block));
        }
        return { ...s, ...next };
      });

      // Enforced pause. Deliberately not a dismissible notification.
      if (consecutiveHigh.current >= ESCALATION_CONSECUTIVE_READS && phaseRef.current === 'focus') {
        consecutiveHigh.current = 0;
        enforcedLeft.current = POMODORO.ENFORCED_BREAK_SECONDS;
        setState((s) => {
          enforcedAtIndex.current = s.readings.length - 1;
          return {
            ...s,
            phase: 'enforced',
            enforcedBreaks: s.enforcedBreaks + 1,
            secondsLeft: POMODORO.ENFORCED_BREAK_SECONDS,
            escalationReason: `Two consecutive ${reading.windowSeconds}-second readings showed sustained high stress (HRV ${Math.round(
              reading.deviationPct ?? 0
            )}% below your baseline). Wick paused the timer.`,
          };
        });
        phaseRef.current = 'enforced';
      }
    },
    [timing.strideSeconds]
  );

  /**
   * Analyses the trailing window and emits a reading, or discards it.
   * Called on a stride boundary in continuous mode, and at the end of each
   * on-window in saver mode.
   */
  const analyseWindow = useCallback(() => {
    const samples = buffer.current;
    if (samples.length < 2) return;

    const span = (samples[samples.length - 1].t - samples[0].t) / 1000;
    if (span <= 0) return;
    const fps = samples.length / span;

    const coverage = samples.filter((s) => s.present).length / samples.length;
    if (coverage < FACE.MIN_FACE_COVERAGE) {
      discardWindow(
        coverage === 0
          ? 'No face in frame — reading discarded'
          : 'You moved out of frame — reading discarded'
      );
      lastEmit.current = Date.now();
      return;
    }

    const raw = samples.map((s) => s.v);
    burstIndex.current += 1;
    lastEmit.current = Date.now();
    setState((s) => ({ ...s, lastDiscardReason: null }));
    ingestReading(raw, fps, movementIndex(raw));
  }, [discardWindow, ingestReading]);

  const runSimulatedReading = useCallback(() => {
    const idx = burstIndex.current++;
    lastEmit.current = Date.now();
    const profile = rampedProfile(idx, simArc);
    ingestReading(simulateBurst(profile, timing.windowSeconds, 30), 30, 0.12);
  }, [ingestReading, simArc, timing.windowSeconds]);

  /* ── per-frame callback ─────────────────────────────────────────── */

  const onSample = useCallback(
    (sample: FrameSample) => {
      const phase = phaseRef.current;

      if (phase === 'setup') {
        setupSamples.current.push(sample);
        const nowPresent = faceDetectionAvailable
          ? facesRef.current.length === 1
          : facePresent(setupSamples.current);
        const elapsed = (Date.now() - setupStart.current) / 1000;
        // Lighting alone is not framing. A wall at a reasonable brightness used
        // to pass this check; presence is now checked first and is not
        // negotiable.
        const issue = checkFaceFraming(
          setupSamples.current.slice(-45),
          faceDetectionAvailable ? facesRef.current.length : null
        );
        setState((s) => ({
          ...s,
          present: nowPresent,
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

      if (!samplingSince.current) return;

      // Presence per frame. Where a real detector exists it is authoritative;
      // otherwise skin coverage of the sampled region stands in for it.
      const present = faceDetectionAvailable
        ? facesRef.current.length === 1
        : sample.skinFraction >= SKIN_PRESENCE_THRESHOLD;

      const now = Date.now();
      buffer.current.push({ v: sample.mean, t: now, present });

      // Drop anything older than the analysis window. This is the only place
      // sample data is retained at all, and it is bounded by wall-clock time
      // rather than count, so a slow frame rate cannot grow it.
      const cutoff = now - timing.windowSeconds * 1000;
      if (buffer.current.length > 0 && buffer.current[0].t < cutoff) {
        let drop = 0;
        while (drop < buffer.current.length && buffer.current[drop].t < cutoff) drop++;
        buffer.current = buffer.current.slice(drop);
      }

      if (!faceDetectionAvailable) {
        setState((s) => (s.present === present ? s : { ...s, present }));
      }
    },
    [timing.windowSeconds]
  );

  /**
   * Face detector callback (iOS only). A second face means someone is behind
   * you: the window is dropped rather than silently averaging two people.
   */
  const onFaces = useCallback(
    (faces: FaceBox[]) => {
      facesRef.current = faces;
      setState((s) => (sameBoxes(s.faces, faces) ? s : { ...s, faces }));
      if (faces.length > 1 && samplingSince.current) {
        buffer.current = [];
        lastEmit.current = Date.now();
        discardWindow('Someone else came into frame — reading discarded');
      }
    },
    [discardWindow]
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
            resetBuffer();
            setState((s) => ({ ...s, phase: 'focus', sampling: true }));
          }
          return;
        }
        // Real camera: the countdown is driven by onSample, which resets it on
        // bad framing. Reaching zero there means three clean consecutive seconds.
        setState((s) => {
          if (s.setupSecondsLeft === 0 && s.phase === 'setup') {
            phaseRef.current = 'focus';
            resetBuffer();
            return { ...s, phase: 'focus', sampling: true };
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
          resetBuffer();
          setState((s) => ({
            ...s,
            phase: 'focus',
            sampling: true,
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
          resetBuffer();
          return {
            ...s,
            phase: 'focus',
            sampling: true,
            elapsedSeconds: 0,
            secondsLeft: s.blockSeconds,
            breaksTaken: s.breaksTaken + 1,
          };
        });
        return;
      }

      if (phase !== 'focus') return;

      /* ── sensing schedule ── */
      const now = Date.now();

      if (!cameraAvailable) {
        if ((now - lastEmit.current) / 1000 >= timing.strideSeconds) runSimulatedReading();
      } else if (timing.continuous) {
        // Camera stays on. Emit whenever a full stride has passed and the
        // buffer covers enough time to be worth analysing.
        const span = buffer.current.length
          ? (buffer.current[buffer.current.length - 1].t - buffer.current[0].t) / 1000
          : 0;
        const due = (now - lastEmit.current) / 1000 >= timing.strideSeconds;
        // The first reading has to wait for a full window; after that each
        // stride slides it forward.
        if (due && span >= Math.min(timing.windowSeconds, SENSING.ANALYSIS_WINDOW_SECONDS) * 0.9) {
          analyseWindow();
        }
      } else {
        // Saver mode: on for windowSeconds, then off until the next interval.
        setState((s) => {
          if (s.sampling) {
            const on = (now - samplingSince.current) / 1000;
            if (on >= timing.windowSeconds) {
              analyseWindow();
              buffer.current = [];
              samplingSince.current = 0;
              secondsUntilWake.current = timing.dutyIntervalSeconds - timing.windowSeconds;
              return { ...s, sampling: false };
            }
            return s;
          }
          secondsUntilWake.current -= 1;
          if (secondsUntilWake.current <= 0) {
            resetBuffer();
            return { ...s, sampling: true };
          }
          return s;
        });
      }

      /* ── movement, tracked every second the camera is on ── */
      const movementWindow = buffer.current.filter(
        (s) => now - s.t <= SENSING.MOVEMENT_WINDOW_SECONDS * 1000
      );
      const live = movementWindow.length >= 8 ? movementIndex(movementWindow.map((s) => s.v)) : 0;
      if (movementWindow.length >= 8) {
        movementTally.current.total += 1;
        if (live > 0.25) movementTally.current.moving += 1;
      }

      /* ── the focus clock ── */
      setState((s) => {
        const elapsedSeconds = s.elapsedSeconds + 1;
        const left = Math.max(0, s.blockSeconds - elapsedSeconds);
        const tally = movementTally.current;
        const common = {
          movementLive: live,
          movementSessionPct: tally.total > 0 ? tally.moving / tally.total : null,
          secondsToNextReading: Math.max(
            0,
            Math.ceil(timing.strideSeconds - (now - lastEmit.current) / 1000)
          ),
        };
        if (left === 0) {
          phaseRef.current = 'break';
          buffer.current = [];
          samplingSince.current = 0;
          return {
            ...s,
            ...common,
            phase: 'break',
            sampling: false,
            elapsedSeconds,
            secondsLeft: breakMinutes * 60,
          };
        }
        return { ...s, ...common, elapsedSeconds, secondsLeft: left };
      });
    }, 1000);
  }, [analyseWindow, breakMinutes, runSimulatedReading, timing]);

  /* ── public controls ────────────────────────────────────────────── */

  const start = useCallback(async () => {
    const baseline = await getBaseline();
    baselineRmssd.current = baseline.calibrationScans >= 3 ? baseline.rmssdBaseline : null;

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
    discarded.current = 0;
    movementTally.current = { moving: 0, total: 0 };
    buffer.current = [];
    samplingSince.current = 0;
    lastEmit.current = Date.now();

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
      movementLive: 0,
      movementSessionPct: null,
      sampling: false,
      baselineReady: baselineRmssd.current !== null,
      simulated: !cameraAvailable,
      secondsToNextReading: timing.windowSeconds,
    }));
    phaseRef.current = 'setup';
    startClock();
  }, [plannedMinutes, startClock, timing.windowSeconds]);

  const end = useCallback((): SessionSummary => {
    stop();
    phaseRef.current = 'ended';
    buffer.current = [];
    samplingSince.current = 0;
    const readings = state.readings;
    const good = readings.filter((r) => r.deviationPct !== null);
    const delta = good.length >= 2 ? good[good.length - 1].deviationPct! - good[0].deviationPct! : null;

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
      discardedWindows: discarded.current,
      movementSessionPct: state.movementSessionPct,
      sensingMode: mode,
      soundscape: null,
    };
  }, [
    mode,
    plannedMinutes,
    state.breaksTaken,
    state.enforcedBreaks,
    state.movementSessionPct,
    state.readings,
  ]);

  /** Skipping the remaining enforced pause is intentionally NOT offered. */
  const takeBreakNow = useCallback(() => {
    if (phaseRef.current !== 'focus') return;
    phaseRef.current = 'break';
    buffer.current = [];
    samplingSince.current = 0;
    setState((s) => ({ ...s, phase: 'break', sampling: false, secondsLeft: breakMinutes * 60 }));
  }, [breakMinutes]);

  /**
   * Camera is live during the setup check and while sampling. In continuous
   * mode that is the whole focus block; during breaks and enforced pauses it is
   * off, because there is nothing to measure and every second off is battery.
   */
  const cameraActive = state.phase === 'setup' || state.sampling;

  /** Stress curve for the trend chart: deviation %, classifiable reads only. */
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
    primaryFace,
    sensingMode: mode,
    windowSeconds: timing.windowSeconds,
    strideSeconds: timing.strideSeconds,
    continuous: timing.continuous,
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
