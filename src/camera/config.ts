/**
 * Capture policy for both camera modes.
 *
 * ── Why the face box, not a fixed ROI ────────────────────────────────
 * Sampling is confined to the detected face's bounding box. Everything outside
 * it — the room, the doorway, whoever walks past behind you — is never read, so
 * bystanders cannot influence the signal. If no face is detected the burst is
 * discarded outright: a wall has enough sensor noise to produce a plausible
 * looking BPM once it has been through a bandpass filter, and reporting that
 * number would be worse than reporting nothing.
 */

export type SensingMode = 'continuous' | 'saver' | 'demo';

export const FACE = {
  /** Green channel: least sensitive to skin tone and ambient colour temperature. */
  CHANNEL: 'green' as const,
  /**
   * Fallback ROI, used only for the brightness pre-check before a face is
   * found. Real sampling always uses the detected face box.
   */
  ROI: { x: 0.32, y: 0.22, w: 0.36, h: 0.34 },
  /**
   * Sample the middle of the face box: forehead and cheeks carry the strongest
   * pulsatile signal, while the edges drift on and off skin as the head moves.
   */
  FACE_ROI_INSET: 0.18,
  /** Read every Nth pixel inside the ROI — same mean, a fraction of the work. */
  PIXEL_STRIDE: 2,
  /**
   * 320x240 rather than 640x480. Every frame collapses to the mean of one
   * channel over a region, so resolution buys nothing here — but it costs ISP
   * throughput and, more importantly, an RGB conversion of every pixel. A
   * quarter of the pixels is roughly a quarter of the per-frame cost, which is
   * what makes continuous sensing affordable at all.
   */
  TARGET_WIDTH: 320,
  TARGET_HEIGHT: 240,
  /**
   * Frame rate is an ACCURACY setting, not a smoothness one. Peak positions are
   * quantised to 1/fps, and RMSSD — the quantity the whole stress model rests
   * on — is typically 20-50 ms. At 15fps the 67ms quantisation alone would
   * exceed the signal. 30fps plus sub-sample peak interpolation (ppgService)
   * brings timing error well under the values being measured.
   */
  TARGET_FPS: 30,
  /**
   * A window needs the face present for at least this fraction of its frames.
   * Below it the window is discarded rather than filtered into a number.
   */
  MIN_FACE_COVERAGE: 0.7,
} as const;

/**
 * ── Continuous sensing ───────────────────────────────────────────────
 *
 * Desk Mode used to open the camera for 12 seconds a minute. That was wrong on
 * two counts, and both were things a duty cycle cannot fix by tuning:
 *
 *   1. 12 seconds is roughly 12-15 beats, so ~11-14 inter-beat intervals. RMSSD
 *      from that few intervals has a confidence interval wide enough to swing a
 *      reading between "Normal" and "High Stress" on noise alone.
 *   2. Restlessness sampled 20% of the time is a coin flip. A user who fidgets
 *      constantly but happens to be still during the burst reads as steady, and
 *      nothing about the design would ever reveal the error.
 *
 * Continuous mode keeps the camera open for the focus block and analyses a
 * sliding window, so readings overlap and movement is observed for 100% of the
 * session rather than 20% of it.
 *
 * The cost is real and is stated plainly in the UI: roughly 12-18% battery per
 * hour on a mid-range phone, against ~4% for the interval mode, which is kept
 * as an explicit battery-saver choice.
 */
export const SENSING = {
  /**
   * Length of the trailing window each reading is computed from. 40s at 30fps
   * is 1200 samples and ~40-70 beats — enough intervals for RMSSD to be a
   * measurement rather than an estimate.
   */
  ANALYSIS_WINDOW_SECONDS: 40,
  /**
   * How often a new reading is emitted. Windows overlap heavily, which is what
   * turns a handful of points into a curve you can actually read a trend off.
   */
  ANALYSIS_STRIDE_SECONDS: 15,
  /**
   * Movement is judged over a much shorter, non-overlapping window so a burst
   * of fidgeting shows up while it is happening rather than 40 seconds later.
   */
  MOVEMENT_WINDOW_SECONDS: 10,
  /** Battery-saver mode: camera open for this long, then off. */
  SAVER_WINDOW_SECONDS: 45,
  SAVER_INTERVAL_SECONDS: 180,
  /** Demo: fast enough that escalation is visible inside a two-minute pitch. */
  DEMO_WINDOW_SECONDS: 20,
  DEMO_STRIDE_SECONDS: 8,
} as const;

export const FINGER = {
  /** A spot check is the accuracy-critical reading, so it gets a longer window. */
  BURST_SECONDS: 45,
  /** Red channel: with the flash on, red carries the strongest pulsatile component. */
  CHANNEL: 'red' as const,
  /** Fingertip covers the whole lens, so the centre half is representative. */
  ROI: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
  PIXEL_STRIDE: 8,
  TARGET_WIDTH: 640,
  TARGET_HEIGHT: 480,
  TARGET_FPS: 30,
  /** Below this mean red level the finger isn't covering the lens properly. */
  MIN_COVERAGE_LEVEL: 90,
} as const;

/**
 * Desk Mode shows a live preview cropped to the detected face.
 *
 * The earlier design showed no preview at all, on the grounds that a live view
 * of the room is the easiest way for a bystander to end up on screen. That was
 * right about the risk and wrong about the cost: without a preview the user has
 * no idea whether they are framed, and no feedback when a reading fails.
 *
 * Cropping to the face box keeps both properties. The user sees themselves, and
 * background pixels are never drawn — not blurred, not composited, simply
 * outside the visible region.
 */
export const PREVIEW_MODE: 'face-crop' | 'full' | 'none' = 'face-crop';

/** Diameter of the cropped face preview, in points. */
export const PREVIEW_SIZE = 96;

/** 3-second framing check before the timer starts. */
export const SETUP_CHECK_SECONDS = 3;

/**
 * Escalation rule. A single high read never locks the timer — rPPG is noisy and
 * a false lockout destroys trust faster than a missed break. Two consecutive
 * good-quality High Stress reads is ~2 minutes of sustained signal at the
 * 60-second cadence.
 */
export const ESCALATION_CONSECUTIVE_READS = 2;

/** Adaptive Pomodoro bounds, in minutes. */
export const POMODORO = {
  DEFAULT_MINUTES: 25,
  MIN_MINUTES: 12,
  MAX_MINUTES: 45,
  /** Selectable break lengths. The user picks; the adaptive logic never overrides it. */
  BREAK_OPTIONS: [3, 5, 10, 15] as const,
  DEFAULT_BREAK_MINUTES: 5,
  /** Guided stand-up + breathing sequence after an enforced pause. */
  ENFORCED_BREAK_SECONDS: 60,
} as const;
