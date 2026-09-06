/**
 * Capture policy for both camera modes.
 *
 * ── Why interval sampling ────────────────────────────────────────────
 * Continuous rPPG for a 25-minute session means 25 minutes of camera +
 * per-frame processing, which is the single biggest battery cost in the app.
 * Desk Mode instead runs a BURST_SECONDS window every BURST_INTERVAL_SECONDS
 * and holds the camera device inactive in between, giving roughly a 7% duty
 * cycle. HRV trends move on a minutes timescale, so nothing useful is lost.
 *
 * ── Why the ROI ──────────────────────────────────────────────────────
 * Only pixels inside a small centred box are ever read. Everything outside it —
 * the room, the doorway, whoever walks past behind you — is never sampled, so
 * bystanders cannot influence the signal and are never part of any computation.
 * Combined with PREVIEW_HIDDEN below, a passer-by is neither measured nor shown.
 */

export const FACE = {
  /** Length of one rPPG burst. ~12s at 30fps = 360 frames, enough for 5+ peaks. */
  BURST_SECONDS: 12,
  /** Gap between bursts. Camera device is fully inactive for this whole span. */
  BURST_INTERVAL_SECONDS: 180,
  /** Green channel: least sensitive to skin tone and ambient colour temperature. */
  CHANNEL: 'green' as const,
  /** Fraction of frame width/height sampled, centred. Face fills this if centred. */
  ROI: { x: 0.32, y: 0.22, w: 0.36, h: 0.34 },
  /** Read every Nth pixel inside the ROI — 16x less work per frame, same mean. */
  PIXEL_STRIDE: 4,
  /** Requested capture size. Smallest workable format = least power and heat. */
  TARGET_WIDTH: 640,
  TARGET_HEIGHT: 480,
  TARGET_FPS: 30,
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
 * Desk Mode never renders a camera preview.
 *
 * Two reasons, both deliberate: a live feed of the room on screen is the most
 * likely way a bystander ends up captured in a screenshot or a shoulder-surf,
 * and a moving video feed is a poor thing to stare at while trying to focus.
 * The user gets a status indicator instead — the same information, none of the
 * exposure. The finger spot check does show a small preview, because there the
 * lens is pressed against a fingertip and the user needs to see coverage.
 */
export const PREVIEW_HIDDEN = true;

/** 3-second framing check before the timer starts. */
export const SETUP_CHECK_SECONDS = 3;

/**
 * Escalation rule. A single high read never locks the timer — rPPG is noisy and
 * a false lockout destroys trust faster than a missed break. Two consecutive
 * good-quality High Stress reads means ~4–6 minutes of sustained signal.
 */
export const ESCALATION_CONSECUTIVE_READS = 2;

/** Adaptive Pomodoro bounds, in minutes. */
export const POMODORO = {
  DEFAULT_MINUTES: 25,
  MIN_MINUTES: 12,
  MAX_MINUTES: 45,
  BREAK_MINUTES: 5,
  /** Guided stand-up + breathing sequence after an enforced pause. */
  ENFORCED_BREAK_SECONDS: 60,
} as const;
