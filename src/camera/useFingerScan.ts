/**
 * useFingerScan — Pillar 3's rear-camera + flash finger-PPG spot check.
 *
 * This is the accuracy-critical reading in Wick: the lens is pressed against a
 * fingertip under constant torch light, so the pulsatile signal is far stronger
 * and cleaner than face rPPG. It is what validates and corrects the Desk Mode
 * trend, and it is the number worth putting in front of a judge.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FINGER } from './config';
import {
  checkFingerCoverage,
  type FrameSample,
  type FramingIssue,
} from './frameSampling';
import { cameraAvailable, requestCameraPermission } from './CaptureCamera';
import { SIM_PROFILES, simulateBurst, type SimProfileName } from './simulator';
import { PPGService, type PPGResult } from '@/services/ppgService';

export type ScanPhase = 'idle' | 'framing' | 'capturing' | 'processing' | 'done' | 'error';

/** Frames must be usable for this long before the countdown starts. */
const FRAMING_SECONDS = 1.5;
/** How much of the live waveform to keep for the on-screen trace. */
const TRACE_LENGTH = 160;

/**
 * Live heart-rate readout.
 *
 * A 45-second countdown with nothing on it but a number going down gives the
 * user no way to tell a good reading from a bad one until it is over. A
 * trailing window re-analysed every couple of seconds shows a BPM settling —
 * and, more usefully, shows it NOT settling when the finger is pressed too hard
 * or resting off-centre, while there is still time to fix it.
 *
 * Twelve seconds is plenty for heart rate (it is a mean of intervals) and
 * nowhere near enough for HRV, which is why only BPM is shown live. The
 * reported RMSSD still comes from the full 45-second window.
 */
const LIVE_WINDOW_SECONDS = 12;
const LIVE_STRIDE_SECONDS = 2;

export interface FingerScanState {
  phase: ScanPhase;
  /** 0–1 through the capture window. */
  progress: number;
  secondsLeft: number;
  framingIssue: FramingIssue;
  result: PPGResult | null;
  error: string | null;
  /** Recent raw samples, for the live pulse trace. Never leaves the device. */
  trace: number[];
  /** Heart rate from the trailing window, so the user can see it settle. */
  liveHeartRate: number | null;
  simulated: boolean;
}

export function useFingerScan(simProfile: SimProfileName = 'neutral') {
  const [state, setState] = useState<FingerScanState>({
    phase: 'idle',
    progress: 0,
    secondsLeft: FINGER.BURST_SECONDS,
    framingIssue: null,
    result: null,
    error: null,
    trace: [],
    liveHeartRate: null,
    simulated: !cameraAvailable,
  });

  const samples = useRef<number[]>([]);
  const lastLiveAt = useRef<number>(0);
  const captureStart = useRef<number>(0);
  const goodFramesSince = useRef<number | null>(null);
  const phaseRef = useRef<ScanPhase>('idle');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const setPhase = (phase: ScanPhase) => {
    phaseRef.current = phase;
    setState((s) => ({ ...s, phase }));
  };

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  useEffect(() => () => stopTimer(), []);

  const finish = useCallback((raw: number[], fps: number) => {
    setPhase('processing');
    // Yield a frame so the UI can paint "processing" before the filter runs.
    setTimeout(() => {
      const result = PPGService.process(raw, fps);
      phaseRef.current = 'done';
      setState((s) => ({ ...s, phase: 'done', progress: 1, secondsLeft: 0, result }));
    }, 60);
  }, []);

  /** Called once per frame from CaptureCamera's frame processor. */
  const onSample = useCallback(
    (sample: FrameSample) => {
      const phase = phaseRef.current;
      if (phase !== 'framing' && phase !== 'capturing') return;

      const issue = checkFingerCoverage(sample, FINGER.MIN_COVERAGE_LEVEL);

      if (phase === 'framing') {
        const now = Date.now();
        if (issue) {
          goodFramesSince.current = null;
        } else if (goodFramesSince.current === null) {
          goodFramesSince.current = now;
        } else if (now - goodFramesSince.current >= FRAMING_SECONDS * 1000) {
          samples.current = [];
          captureStart.current = now;
          phaseRef.current = 'capturing';
          setState((s) => ({ ...s, phase: 'capturing', framingIssue: null }));
          return;
        }
        setState((s) => (s.framingIssue === issue ? s : { ...s, framingIssue: issue }));
        return;
      }

      // Capturing. A finger that lifts mid-scan invalidates the window, so the
      // scan restarts framing rather than quietly returning a garbage number.
      if (issue) {
        goodFramesSince.current = null;
        phaseRef.current = 'framing';
        setState((s) => ({ ...s, phase: 'framing', framingIssue: issue, progress: 0 }));
        return;
      }

      samples.current.push(sample.mean);
      const now = Date.now();
      const elapsed = (now - captureStart.current) / 1000;

      // Live BPM from the trailing window. Cheap enough to run every couple of
      // seconds: one filtfilt over ~360 samples.
      if (
        elapsed >= LIVE_WINDOW_SECONDS &&
        now - lastLiveAt.current >= LIVE_STRIDE_SECONDS * 1000
      ) {
        lastLiveAt.current = now;
        const fps = samples.current.length / elapsed;
        const window = samples.current.slice(-Math.round(LIVE_WINDOW_SECONDS * fps));
        const snapshot = PPGService.process(window, fps);
        if (snapshot.heartRate !== null) {
          setState((st) => ({ ...st, liveHeartRate: snapshot.heartRate }));
        }
      }

      if (elapsed >= FINGER.BURST_SECONDS) {
        // Use the *measured* frame rate. Trusting the requested 30fps would
        // scale every BPM by whatever the device actually delivered.
        const fps = samples.current.length / elapsed;
        finish([...samples.current], fps);
        return;
      }

      setState((s) => ({
        ...s,
        progress: elapsed / FINGER.BURST_SECONDS,
        secondsLeft: Math.ceil(FINGER.BURST_SECONDS - elapsed),
        trace: [...s.trace, sample.mean].slice(-TRACE_LENGTH),
      }));
    },
    [finish]
  );

  /** Simulation path: same pipeline, synthetic input, real elapsed time. */
  const runSimulated = useCallback(() => {
    const seconds = 8; // shorter than a real scan so a demo doesn't stall
    const start = Date.now();
    const preview = simulateBurst(SIM_PROFILES[simProfile], seconds, 30);
    setPhase('capturing');

    stopTimer();
    timer.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      if (elapsed >= seconds) {
        stopTimer();
        const raw = simulateBurst(SIM_PROFILES[simProfile], FINGER.BURST_SECONDS, 30);
        finish(raw, 30);
        return;
      }
      const upto = Math.floor((elapsed / seconds) * preview.length);
      setState((s) => ({
        ...s,
        progress: elapsed / seconds,
        secondsLeft: Math.ceil(seconds - elapsed),
        trace: preview.slice(Math.max(0, upto - TRACE_LENGTH), upto),
      }));
    }, 60);
  }, [finish, simProfile]);

  const start = useCallback(async () => {
    samples.current = [];
    goodFramesSince.current = null;
    lastLiveAt.current = 0;
    setState({
      phase: 'idle',
      progress: 0,
      secondsLeft: FINGER.BURST_SECONDS,
      framingIssue: null,
      result: null,
      error: null,
      trace: [],
      liveHeartRate: null,
      simulated: !cameraAvailable,
    });

    if (!cameraAvailable) {
      runSimulated();
      return;
    }

    const granted = await requestCameraPermission();
    if (!granted) {
      phaseRef.current = 'error';
      setState((s) => ({
        ...s,
        phase: 'error',
        error: 'Camera access is needed for the spot check. You can still use a self-report instead.',
      }));
      return;
    }
    setPhase('framing');
  }, [runSimulated]);

  const cancel = useCallback(() => {
    stopTimer();
    samples.current = [];
    goodFramesSince.current = null;
    phaseRef.current = 'idle';
    lastLiveAt.current = 0;
    setState((s) => ({ ...s, phase: 'idle', progress: 0, trace: [], liveHeartRate: null }));
  }, []);

  const cameraActive = state.phase === 'framing' || state.phase === 'capturing';

  return { ...state, start, cancel, onSample, cameraActive };
}
