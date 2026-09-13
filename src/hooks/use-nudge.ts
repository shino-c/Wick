/**
 * useNudge — when the engine gets asked.
 *
 * Two triggers, both of them moments the user is already looking at Wick: the
 * app coming to the foreground, and the screen taking focus. Never a timer.
 *
 * That is a deliberate limit, not an unfinished one. A timer firing while the
 * app is closed is a push notification, and a push notification is a much
 * riskier thing to get wrong — a mistimed one gets the app deleted, where a
 * mistimed in-app sheet just gets swiped away. The timing rules want a few
 * weeks of real acceptance data before they earn the right to buzz a pocket.
 */

import { useFocusEffect } from 'expo-router';
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import type { Nudge } from '@/data/types';
import { evaluateNudge } from '@/services/nudgeService';

/**
 * Evaluations are cheap but not free, and a user flicking between tabs would
 * otherwise trigger one per tap. The engine's own gates would keep them all
 * quiet, but there is no reason to do the work.
 */
const MIN_EVAL_GAP_MS = 60_000;

export function useNudge(enabled = true) {
  const [nudge, setNudge] = React.useState<Nudge | null>(null);
  const lastEval = React.useRef(0);
  // Held in a ref as well as state: the check runs inside callbacks that
  // captured an older render, and showing a second sheet over an open one
  // would burn the daily cap on a nudge nobody ever saw.
  const showing = React.useRef(false);

  const check = React.useCallback(async () => {
    if (!enabled || showing.current) return;
    const now = Date.now();
    if (now - lastEval.current < MIN_EVAL_GAP_MS) return;
    lastEval.current = now;
    try {
      const decision = await evaluateNudge();
      if (decision.nudge && !showing.current) {
        showing.current = true;
        setNudge(decision.nudge);
      }
    } catch (err) {
      // A nudge is the least important thing on any screen. It never breaks one.
      console.error('Nudge evaluation failed:', err);
    }
  }, [enabled]);

  useFocusEffect(
    React.useCallback(() => {
      check();
    }, [check])
  );

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  const close = React.useCallback(() => {
    showing.current = false;
    setNudge(null);
    // The outcome was already recorded by whichever control closed the sheet.
    // Re-arm the throttle so dismissing one does not immediately evaluate again.
    lastEval.current = Date.now();
  }, []);

  return { nudge, close };
}

export default useNudge;
