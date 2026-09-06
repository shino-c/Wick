/**
 * useBreathingScan — guided breathing with the finger sensor running.
 *
 * The breathing screen used to be a timer with a circle on it: it produced no
 * evidence, in the pillar whose entire job is evidence. Yet paced breathing is
 * the one intervention in the app with a large, fast, well-documented effect on
 * exactly the quantity Wick already measures.
 *
 * ── Why this cannot be one 60-second measurement ────────────────────
 * The sensor and the pacer DO run simultaneously — the finger never leaves the
 * lens and the recording is continuous from the first second to the last. What
 * cannot be compressed is the comparison. "Did breathing change anything" is a
 * question about a difference, and a difference needs two measurements with the
 * intervention between them. One window taken during the exercise gives a
 * single number with nothing to hold it against.
 *
 * Worse, that single number would be actively misleading. At ~5.5 breaths per
 * minute respiratory sinus arrhythmia is at its maximum: heart rate swings up
 * on the inhale and down on the exhale, which inflates RMSSD directly, as a
 * mechanical consequence of the breathing itself. A big number during the
 * exercise is not evidence that anything shifted — it is evidence that you were
 * breathing slowly, which we already knew because we asked you to.
 *
 * So: three windows from one unbroken recording.
 *
 *     BEFORE  (30s)  sit normally — the reference
 *     BREATHE (60s)  follow the pacer
 *     AFTER   (30s)  sit normally again — what actually persisted
 *
 * Two minutes total, down from two and a half. Thirty seconds is the floor
 * (MIN_HRV_SECONDS) rather than a comfortable margin, and the UI says so.
 *
 * ── The live readout ────────────────────────────────────────────────
 * Waiting two minutes for three numbers feels like nothing is happening, so a
 * trailing 30-second window is also analysed every 5 seconds throughout. That
 * gives a live HRV figure and a curve that visibly climbs during the paced
 * segment — the "measuring while you breathe" experience, without pretending a
 * live number is the result.
 *
 * The live values are explicitly NOT the reported ones: near a segment boundary
 * the trailing window straddles two different states, so it is smeared. The
 * three reported numbers come from clean, non-overlapping per-segment windows.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FINGER } from './config';
import { checkFingerCoverage, type FrameSample, type FramingIssue } from './frameSampling';
import { cameraAvailable, requestCameraPermission } from './CaptureCamera';
import { SIM_PROFILES, simulateBurst } from './simulator';
import { PPGService, type PPGResult } from '@/services/ppgService';

export type BreathPhase =
  | 'idle'
  | 'framing'
  | 'before'
  | 'breathe'
  | 'after'
  | 'processing'
  | 'done'
  | 'error';

/**
 * Seconds per segment. `before` and `after` sit exactly on MIN_HRV_SECONDS —
 * the shortest window from which RMSSD is reportable at all, which is what
 * keeps the whole exercise to two minutes.
 */
export const SEGMENTS = { before: 30, breathe: 60, after: 30 } as const;

/**
 * Live readout: a trailing window re-analysed on this stride, purely so the
 * screen has something moving on it. Never the reported result — near a segment
 * boundary this window straddles two states.
 */
const LIVE_WINDOW_SECONDS = 30;
const LIVE_STRIDE_SECONDS = 5;

/** Frames must be usable for this long before a segment starts. */
const FRAMING_SECONDS = 1.5;
const TRACE_LENGTH = 160;

export interface BreathingScanState {
  phase: BreathPhase;
  /** 0–1 through the current segment. */
  progress: number;
  secondsLeft: number;
  framingIssue: FramingIssue;
  /** Set when a segment had to restart, so the user knows why the clock moved. */
  restartNote: string | null;
  before: PPGResult | null;
  during: PPGResult | null;
  after: PPGResult | null;
  error: string | null;
  trace: number[];
  /** Indicative HRV from the trailing window, updated every few seconds. */
  liveRmssd: number | null;
  liveHeartRate: number | null;
  /** Every live HRV value so far, for the curve that climbs while you breathe. */
  liveSeries: number[];
  simulated: boolean;
}

const EMPTY: BreathingScanState = {
  phase: 'idle',
  progress: 0,
  secondsLeft: SEGMENTS.before,
  framingIssue: null,
  restartNote: null,
  before: null,
  during: null,
  after: null,
  error: null,
  trace: [],
  liveRmssd: null,
  liveHeartRate: null,
  liveSeries: [],
  simulated: !cameraAvailable,
};

type Segment = 'before' | 'breathe' | 'after';
const ORDER: Segment[] = ['before', 'breathe', 'after'];

export function useBreathingScan() {
  const [state, setState] = useState<BreathingScanState>(EMPTY);

  const phaseRef = useRef<BreathPhase>('idle');
  const segmentRef = useRef<Segment>('before');
  const samples = useRef<number[]>([]);
  const segmentStart = useRef<number>(0);
  const goodFramesSince = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const results = useRef<Partial<Record<Segment, PPGResult>>>({});
  /** Rolling buffer for the live readout, spanning segment boundaries. */
  const live = useRef<{ v: number; t: number }[]>([]);
  const lastLiveAt = useRef<number>(0);

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => () => stopTimer(), []);

  const setPhase = (phase: BreathPhase, extra: Partial<BreathingScanState> = {}) => {
    phaseRef.current = phase;
    setState((s) => ({ ...s, phase, ...extra }));
  };

  /** Finishes the current segment and either advances or completes the run. */
  const closeSegment = useCallback((raw: number[], fps: number) => {
    const segment = segmentRef.current;
    results.current[segment] = PPGService.process(raw, fps);

    const next = ORDER[ORDER.indexOf(segment) + 1];
    if (next) {
      segmentRef.current = next;
      samples.current = [];
      segmentStart.current = Date.now();
      phaseRef.current = next === 'breathe' ? 'breathe' : 'after';
      setState((s) => ({
        ...s,
        phase: next === 'breathe' ? 'breathe' : 'after',
        progress: 0,
        secondsLeft: SEGMENTS[next],
        restartNote: null,
        before: results.current.before ?? s.before,
        during: results.current.breathe ?? s.during,
      }));
      return;
    }

    setPhase('processing');
    setTimeout(() => {
      phaseRef.current = 'done';
      setState((s) => ({
        ...s,
        phase: 'done',
        progress: 1,
        secondsLeft: 0,
        before: results.current.before ?? null,
        during: results.current.breathe ?? null,
        after: results.current.after ?? null,
      }));
    }, 60);
  }, []);

  /** Called once per frame from CaptureCamera's frame processor. */
  const onSample = useCallback(
    (sample: FrameSample) => {
      const phase = phaseRef.current;
      const measuring = phase === 'before' || phase === 'breathe' || phase === 'after';
      if (phase !== 'framing' && !measuring) return;

      const issue = checkFingerCoverage(sample, FINGER.MIN_COVERAGE_LEVEL);

      if (phase === 'framing') {
        const now = Date.now();
        if (issue) {
          goodFramesSince.current = null;
        } else if (goodFramesSince.current === null) {
          goodFramesSince.current = now;
        } else if (now - goodFramesSince.current >= FRAMING_SECONDS * 1000) {
          samples.current = [];
          segmentStart.current = now;
          const segment = segmentRef.current;
          phaseRef.current = segment === 'breathe' ? 'breathe' : segment === 'after' ? 'after' : 'before';
          setState((s) => ({
            ...s,
            phase: phaseRef.current,
            framingIssue: null,
            progress: 0,
            secondsLeft: SEGMENTS[segment],
          }));
          return;
        }
        setState((s) => (s.framingIssue === issue ? s : { ...s, framingIssue: issue }));
        return;
      }

      // Lifting the finger mid-segment leaves a gap in the series, and a gap
      // becomes a fake inter-beat interval once the filter runs. The segment
      // restarts rather than producing a number built partly out of a hole.
      if (issue) {
        goodFramesSince.current = null;
        phaseRef.current = 'framing';
        setState((s) => ({
          ...s,
          phase: 'framing',
          framingIssue: issue,
          progress: 0,
          restartNote: 'Finger lifted — this step restarted so the reading stays honest.',
        }));
        return;
      }

      samples.current.push(sample.mean);
      const segment = segmentRef.current;
      const now = Date.now();
      const elapsed = (now - segmentStart.current) / 1000;

      // Live readout. Deliberately independent of the segment boundaries: the
      // point is a number that moves while you breathe, not a result.
      live.current.push({ v: sample.mean, t: now });
      const cutoff = now - LIVE_WINDOW_SECONDS * 1000;
      while (live.current.length && live.current[0].t < cutoff) live.current.shift();

      if (
        now - lastLiveAt.current >= LIVE_STRIDE_SECONDS * 1000 &&
        live.current.length > 2 &&
        (live.current[live.current.length - 1].t - live.current[0].t) / 1000 >=
          LIVE_WINDOW_SECONDS * 0.9
      ) {
        lastLiveAt.current = now;
        const span = (live.current[live.current.length - 1].t - live.current[0].t) / 1000;
        const snapshot = PPGService.process(
          live.current.map((x) => x.v),
          live.current.length / span
        );
        if (snapshot.hrvRmssd !== null) {
          setState((st) => ({
            ...st,
            liveRmssd: snapshot.hrvRmssd,
            liveHeartRate: snapshot.heartRate,
            liveSeries: [...st.liveSeries, snapshot.hrvRmssd as number].slice(-40),
          }));
        }
      }

      if (elapsed >= SEGMENTS[segment]) {
        // Measured frame rate, not the requested one — trusting 30fps would
        // scale every BPM by whatever the device actually delivered.
        closeSegment([...samples.current], samples.current.length / elapsed);
        return;
      }

      setState((s) => ({
        ...s,
        progress: elapsed / SEGMENTS[segment],
        secondsLeft: Math.ceil(SEGMENTS[segment] - elapsed),
        trace: [...s.trace, sample.mean].slice(-TRACE_LENGTH),
      }));
    },
    [closeSegment]
  );

  /** Simulation path: same pipeline, synthetic input, compressed timing. */
  const runSimulated = useCallback(() => {
    const compressed = 6;
    let index = 0;
    const start = Date.now();
    segmentRef.current = 'before';
    phaseRef.current = 'before';
    setState((s) => ({ ...s, phase: 'before', secondsLeft: compressed }));

    stopTimer();
    timer.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000 - index * compressed;
      if (elapsed >= compressed) {
        const segment = ORDER[index];
        // The 'breathing' profile has a much wider beat-to-beat wander, which
        // is what paced breathing actually produces. The simulator fakes the
        // INPUT and lets the real pipeline compute the answer.
        const profile = segment === 'breathe' ? SIM_PROFILES.breathing : SIM_PROFILES.neutral;
        results.current[segment] = PPGService.process(
          simulateBurst(profile, SEGMENTS[segment], 30),
          30
        );
        index += 1;
        if (index >= ORDER.length) {
          stopTimer();
          phaseRef.current = 'done';
          setState((s) => ({
            ...s,
            phase: 'done',
            progress: 1,
            secondsLeft: 0,
            before: results.current.before ?? null,
            during: results.current.breathe ?? null,
            after: results.current.after ?? null,
          }));
          return;
        }
        segmentRef.current = ORDER[index];
        phaseRef.current = ORDER[index] === 'breathe' ? 'breathe' : 'after';
        setState((s) => ({ ...s, phase: phaseRef.current, progress: 0 }));
        return;
      }
      setState((s) => ({
        ...s,
        progress: elapsed / compressed,
        secondsLeft: Math.ceil(compressed - elapsed),
      }));
    }, 100);
  }, []);

  const start = useCallback(async () => {
    samples.current = [];
    results.current = {};
    live.current = [];
    lastLiveAt.current = 0;
    segmentRef.current = 'before';
    goodFramesSince.current = null;
    setState({ ...EMPTY, simulated: !cameraAvailable });

    if (!cameraAvailable) {
      runSimulated();
      return;
    }
    const granted = await requestCameraPermission();
    if (!granted) {
      setPhase('error', {
        error: 'Camera access is needed to measure the effect. You can still follow the pacer.',
      });
      return;
    }
    setPhase('framing');
  }, [runSimulated]);

  const cancel = useCallback(() => {
    stopTimer();
    samples.current = [];
    results.current = {};
    live.current = [];
    lastLiveAt.current = 0;
    segmentRef.current = 'before';
    goodFramesSince.current = null;
    phaseRef.current = 'idle';
    setState({ ...EMPTY, simulated: !cameraAvailable });
  }, []);

  const cameraActive =
    state.phase === 'framing' ||
    state.phase === 'before' ||
    state.phase === 'breathe' ||
    state.phase === 'after';

  return { ...state, start, cancel, onSample, cameraActive, segment: segmentRef.current };
}

/**
 * The number the whole exercise exists to produce.
 *
 * Deliberately the BEFORE → AFTER change, not before → during. RMSSD is huge
 * while you are breathing at six a minute because the breathing is driving it
 * directly; that is a mechanical fact, not evidence that anything shifted. What
 * is still there forty-five seconds after you stop is the part worth reporting.
 */
export function breathingEffect(before: PPGResult | null, after: PPGResult | null) {
  if (!before?.hrvRmssd || !after?.hrvRmssd) return null;
  const deltaMs = Math.round((after.hrvRmssd - before.hrvRmssd) * 10) / 10;
  const deltaPct = Math.round((deltaMs / before.hrvRmssd) * 1000) / 10;
  const hrDelta =
    before.heartRate && after.heartRate
      ? Math.round((after.heartRate - before.heartRate) * 10) / 10
      : null;
  return { deltaMs, deltaPct, hrDelta, improved: deltaMs > 0 };
}
