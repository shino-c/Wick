/**
 * Capture policy for both camera modes.
 *
 * ── Why interval sampling ────────────────────────────────────────────
 * Continuous rPPG for a 25-minute session means 25 minutes of camera plus
 * per-frame processing, the single biggest battery cost in the app. Desk Mode
 * runs a BURST_SECONDS window every BURST_INTERVAL_SECONDS and holds the camera
 * inactive in between. At 12s/60s that is a ~20% duty cycle and roughly 25
 * readings across a 25-minute session — dense enough that the stress curve is
 * actually a curve, and that the two-consecutive-reads lock can react within a
 * couple of minutes rather than six.
 *
 * ── Why the face box, not a fixed ROI ────────────────────────────────
 * Sampling is confined to the detected face's bounding box. Everything outside
 * it — the room, the doorway, whoever walks past behind you — is never read, so
 * bystanders cannot influence the signal. If no face is detected the burst is
 * discarded outright: a wall has enough sensor noise to produce a plausible
 * looking BPM once it has been through a bandpass filter, and reporting that
 * number would be worse than reporting nothing.
 */

export const FACE = {
  /** Length of one rPPG burst. ~12s at 30fps = 360 frames, enough for 5+ peaks. */
  BURST_SECONDS: 12,
  /** Gap between bursts. Camera device is fully inactive for this whole span. */
  BURST_INTERVAL_SECONDS: 60,
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
  /** Read every Nth pixel inside the ROI — 16x less work per frame, same mean. */
  PIXEL_STRIDE: 4,
  TARGET_WIDTH: 640,
  TARGET_HEIGHT: 480,
  TARGET_FPS: 30,
  /**
   * A burst needs the face present for at least this fraction of its frames.
   * Below it the window is discarded rather than filtered into a number.
   */
  MIN_FACE_COVERAGE: 0.7,
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
