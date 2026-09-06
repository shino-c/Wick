/**
 * simulator.ts — synthetic PPG for when there is no usable camera.
 *
 * This is not a stub that fakes the *answer*. It fakes the *input*: it produces
 * a raw per-frame intensity series with realistic pulse shape, respiratory
 * drift and sensor noise, and that series then goes through the exact same
 * ppgService pipeline as a real capture. Every number on screen in simulation
 * mode was genuinely computed by the filter and peak detector.
 *
 * It exists so the app is fully walkable in Expo Go, on a simulator, and on a
 * laptop with no camera — and so the enforced-break escalation can be
 * demonstrated on demand rather than waiting for someone to actually get
 * stressed on stage.
 */

export interface SimProfile {
  /** Target heart rate in BPM. */
  bpm: number;
  /** Target beat-to-beat variability in ms. Lower = more sympathetic drive. */
  jitterMs: number;
  /** Sensor noise amplitude. */
  noise: number;
}

export const SIM_PROFILES = {
  relaxed: { bpm: 66, jitterMs: 62, noise: 0.25 },
  neutral: { bpm: 74, jitterMs: 38, noise: 0.35 },
  strained: { bpm: 88, jitterMs: 16, noise: 0.5 },
  noisy: { bpm: 78, jitterMs: 30, noise: 6 },
} as const satisfies Record<string, SimProfile>;

export type SimProfileName = keyof typeof SIM_PROFILES;

/**
 * Generates one burst worth of raw samples.
 *
 * @param profile physiology to emulate
 * @param seconds burst length
 * @param fps     frame rate to emulate
 */
export function simulateBurst(profile: SimProfile, seconds: number, fps: number): number[] {
  const n = Math.round(seconds * fps);
  const out: number[] = [];
  let phase = 0;
  let rng = (Date.now() % 100000) + 1;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return (rng / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < n; i++) {
    const t = i / fps;
    // Beat-to-beat interval wanders by jitterMs — this is what becomes RMSSD.
    const period = 60 / profile.bpm + (profile.jitterMs / 1000) * rand() * 0.5;
    phase += 1 / (fps * period);
    // Systolic upstroke plus a dicrotic notch, roughly PPG-shaped.
    const pulse = Math.sin(2 * Math.PI * phase) + 0.35 * Math.sin(4 * Math.PI * phase + 0.9);
    // 0.25 Hz respiratory sway + slow hand/head drift.
    const drift = 0.6 * Math.sin(2 * Math.PI * 0.25 * t) + 0.3 * Math.sin(2 * Math.PI * 0.03 * t);
    out.push(140 + 5 * pulse + drift + profile.noise * rand());
  }
  return out;
}

/**
 * Session-length stress arc for Desk Mode demos.
 *
 * `ramp` walks the profile from relaxed toward strained across the session so
 * consecutive bursts show HRV genuinely falling — which is what trips the
 * two-consecutive-reads escalation lock, on real logic, at a predictable moment.
 */
export function rampedProfile(burstIndex: number, mode: 'steady' | 'ramp'): SimProfile {
  if (mode === 'steady') return SIM_PROFILES.neutral;
  const stages: SimProfile[] = [
    SIM_PROFILES.relaxed,
    SIM_PROFILES.neutral,
    SIM_PROFILES.strained,
    SIM_PROFILES.strained,
  ];
  return stages[Math.min(burstIndex, stages.length - 1)];
}
