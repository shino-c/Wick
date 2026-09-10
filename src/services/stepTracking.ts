/**
 * Real step tracking for recovery plans.
 *
 * Backed by expo-sensors' Pedometer: a device step counter (Android) or the
 * motion coprocessor (iOS), both included in Expo Go and this project's build.
 * Progress is measured, not guessed — a steps plan can only be completed by
 * actually walking.
 */
import { Pedometer } from 'expo-sensors';

export interface StepSubscription {
  /** Stop the live counter. Safe to call more than once. */
  stop: () => void;
}

/** Whether the device has a step counter the plan tracker can use. */
export async function isStepTrackingAvailable(): Promise<boolean> {
  try {
    return await Pedometer.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Ask for step data access. iOS shows a prompt; Android usually grants it. */
export async function ensureStepPermission(): Promise<boolean> {
  try {
    const result = await Pedometer.requestPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

/** Steps taken between two dates. iOS-only; Android stays 0. */
export async function getStepsBetween(start: Date, end: Date): Promise<number> {
  try {
    const result = await Pedometer.getStepCountAsync(start, end);
    return result?.steps ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Report steps counted since the subscription started — a live "reset" counter.
 * Foreground only on both platforms. Returns a stop handle.
 */
export function watchStepsFromNow(onSteps: (steps: number) => void): StepSubscription {
  let baseline: number | null = null;
  const subscription = Pedometer.watchStepCount(({ steps }) => {
    if (baseline === null) {
      baseline = steps;
      return;
    }
    onSteps(Math.max(0, steps - baseline));
  });
  return { stop: () => subscription.remove() };
}