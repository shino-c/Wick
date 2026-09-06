import React from 'react';
import { Animated, Easing, View } from 'react-native';
import { colors, spacing } from '@/theme';
import { Eyebrow, Txt } from './base';

/**
 * Guided breathing pacer.
 *
 * Paced at 4s inhale / 2s hold / 5s exhale = an 11-second cycle, or ~5.5
 * breaths per minute. That rate sits at the resonance frequency for most
 * adults, where the baroreflex and respiration line up and HRV amplitude peaks
 * — which is exactly the vagal response an enforced pause is trying to trigger.
 *
 * A longer exhale than inhale is the part that matters: it's the exhale that
 * carries the parasympathetic activation.
 */
const INHALE = 4000;
const HOLD = 2000;
const EXHALE = 5000;
export const CYCLE_MS = INHALE + HOLD + EXHALE;
export const BREATHS_PER_MIN = Math.round((60000 / CYCLE_MS) * 10) / 10;

type Phase = 'inhale' | 'hold' | 'exhale';

export function BreathingPacer({
  size = 220,
  dark = false,
  onCycle,
}: {
  size?: number;
  dark?: boolean;
  onCycle?: (count: number) => void;
}) {
  const scale = React.useRef(new Animated.Value(0.55)).current;
  const [phase, setPhase] = React.useState<Phase>('inhale');
  const [secondsLeft, setSecondsLeft] = React.useState(INHALE / 1000);
  const cycles = React.useRef(0);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    let timers: ReturnType<typeof setTimeout>[] = [];

    const step = (next: Phase) => {
      if (!mounted.current) return;
      setPhase(next);
      const ms = next === 'inhale' ? INHALE : next === 'hold' ? HOLD : EXHALE;
      setSecondsLeft(ms / 1000);

      if (next !== 'hold') {
        Animated.timing(scale, {
          toValue: next === 'inhale' ? 1 : 0.55,
          duration: ms,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start();
      }

      timers.push(
        setTimeout(() => {
          if (next === 'exhale') {
            cycles.current += 1;
            onCycle?.(cycles.current);
            step('inhale');
          } else {
            step(next === 'inhale' ? 'hold' : 'exhale');
          }
        }, ms)
      );
    };

    step('inhale');
    const ticker = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);

    return () => {
      mounted.current = false;
      timers.forEach(clearTimeout);
      clearInterval(ticker);
    };
  }, [onCycle, scale]);

  const label = phase === 'inhale' ? 'Inhale' : phase === 'hold' ? 'Hold' : 'Exhale';
  const ring = dark ? colors.onNight : colors.calm;
  const wash = dark ? colors.nightSoft : colors.calmWash;

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: wash,
            borderWidth: 1.5,
            borderColor: ring,
            transform: [{ scale }],
          }}
        />
        <View style={{ alignItems: 'center' }}>
          <Txt v="title" color={dark ? colors.onNight : colors.ink}>
            {label}
          </Txt>
          <Txt v="display" color={dark ? colors.onNight : colors.ink}>
            {Math.ceil(secondsLeft)}
          </Txt>
        </View>
      </View>
      <View style={{ marginTop: spacing(4), alignItems: 'center', gap: spacing(1) }}>
        <Eyebrow color={dark ? colors.onNightSoft : colors.inkFaint}>
          Target {BREATHS_PER_MIN} breaths/min
        </Eyebrow>
        <Txt v="small" color={dark ? colors.onNightSoft : colors.inkFaint}>
          ◍ Vagal tone pacing
        </Txt>
      </View>
    </View>
  );
}
