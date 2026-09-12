/**
 * stepTracking.web.ts — the web counterpart of stepTracking.ts.
 *
 * Metro picks this file automatically for `npm run web` / `expo export -p web`
 * because of the `.web.` suffix, so the native build never sees it and the
 * native file is never rewritten. Same exports, same signatures.
 *
 * WHY THIS EXISTS: `expo-sensors`' Pedometer is a native module. On web the
 * import itself throws before React can mount, which takes the whole page down
 * with it. Importing it *inside* the try/catch would not help either — a static
 * ES import is hoisted and evaluated before any of this module's code runs.
 *
 * A browser genuinely has no step counter (and the ones that do expose it via
 * a permission-gated Web API no Expo app can assume), so there is nothing to
 * implement here. Reporting "unavailable" is the honest answer, and the plan
 * tracker already renders its empty state when it hears that.
 */

export interface StepSubscription {
  stop: () => void;
}

/** No pedometer in the browser. */
export async function isStepTrackingAvailable(): Promise<boolean> {
  return false;
}

/** Nothing to request, so nothing is prompted. */
export async function ensureStepPermission(): Promise<boolean> {
  return false;
}

/** No step source, so zero rather than a fabricated number. */
export async function getStepsBetween(_start: Date, _end: Date): Promise<number> {
  return 0;
}

/**
 * Returns an inert handle so callers can subscribe and clean up without
 * branching on the platform. A no-op `stop` is what keeps hook teardown
 * identical on web and native.
 */
export function watchStepsFromNow(_onSteps: (steps: number) => void): StepSubscription {
  return { stop: () => { } };
}
