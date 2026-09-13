/**
 * taskPickers.tsx — Shared chip pickers used by the task edit modals on Home
 * and Baseline.
 *
 * DateChipPicker shows only the current week's Mon–Sun chips (the database
 * stores a single week, so next-week tasks can't be logged). TimePicker uses
 * compact hour / minute / AM-PM tap-steppers instead of a long row of preset
 * times, plus an "All day" toggle.
 */

import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '@/theme';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** ISO dates (YYYY-MM-DD) for the current week, Monday first. */
function getCurrentWeekDates(): string[] {
  const today = new Date();
  const monday = new Date(today);
  const day = today.getDay();
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

/**
 * Mon–Sun of the current week as tappable chips.
 *
 * Only the current week can be scheduled: the database stores a single week's
 * data and the home dashboard only reads the current week. There is therefore
 * intentionally no "Other…" / next-week fallback here.
 */
export function DateChipPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (iso: string) => void;
}) {
  const weekDates = getCurrentWeekDates();
  const selectedInWeek = !!value && weekDates.includes(value);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.row}>
        {weekDates.map((iso, i) => {
          const d = new Date(iso + 'T00:00:00');
          const isSelected = value === iso && selectedInWeek;
          return (
            <Pressable
              key={iso}
              onPress={() => onChange(iso)}
              style={[styles.chip, isSelected && styles.chipActive]}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                {DAY_NAMES[i]}
              </Text>
              <Text style={[styles.chipSub, isSelected && styles.chipTextActive]}>
                {d.getDate()}/{d.getMonth() + 1}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}
/**
 * TimePicker — a compact tap-stepper time control.
 *
 * Instead of a long row of preset-time chips, hour, minute and AM/PM are three
 * small steppers (1–12 : 00–59, AM/PM toggle) so the control stays tiny on
 * screen. "All day" clears the time entirely.
 */
export function TimePicker({
  value,
  onChange,
}: {
  value?: string;
  /** Receives a 24h "HH:MM" string, or undefined for "All Day". */
  onChange: (time: string | undefined) => void;
}) {
  const parts = timeParts(value);
  const isAllDay = !value;

  const setHour = (hour12: number) => onChange(to24({ ...parts, hour12 }));
  const setMinute = (minute: number) => onChange(to24({ ...parts, minute }));
  const setPeriod = (period: 'AM' | 'PM') => onChange(to24({ ...parts, period }));

  return (
    <View style={styles.timePicker}>
      <Pressable
        onPress={() => onChange(undefined)}
        style={[styles.timeChip, isAllDay && styles.timeChipActive]}
      >
        <Text style={[styles.timeChipText, isAllDay && styles.timeChipTextActive]}>
          All day
        </Text>
      </Pressable>

      <View style={styles.timeSteppers}>
        {/* Hour */}
        <View style={styles.timeUnit}>
          <Pressable
            onPress={() => setHour(wrapValue(parts.hour12 - 1, 1, 12))}
            style={styles.timeStepBtn}
            hitSlop={4}
          >
            <Text style={styles.timeStepText}>−</Text>
          </Pressable>
          <Text style={styles.timeValue}>{parts.hour12}</Text>
          <Pressable
            onPress={() => setHour(wrapValue(parts.hour12 + 1, 1, 12))}
            style={styles.timeStepBtn}
            hitSlop={4}
          >
            <Text style={styles.timeStepText}>+</Text>
          </Pressable>
        </View>

        <Text style={styles.timeColon}>:</Text>

        {/* Minute */}
        <View style={styles.timeUnit}>
          <Pressable
            onPress={() => setMinute(wrapValue(parts.minute - 1, 0, 59))}
            style={styles.timeStepBtn}
            hitSlop={4}
          >
            <Text style={styles.timeStepText}>−</Text>
          </Pressable>
          <Text style={styles.timeValue}>{String(parts.minute).padStart(2, '0')}</Text>
          <Pressable
            onPress={() => setMinute(wrapValue(parts.minute + 1, 0, 59))}
            style={styles.timeStepBtn}
            hitSlop={4}
          >
            <Text style={styles.timeStepText}>+</Text>
          </Pressable>
        </View>

        {/* AM / PM */}
        <Pressable
          onPress={() => setPeriod(parts.period === 'AM' ? 'PM' : 'AM')}
          style={[styles.timeChip, styles.periodChip]}
        >
          <Text style={styles.timeChipText}>{parts.period}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Derives a 24h "HH:MM" end time from a start time plus a duration in hours.
 *
 * Used by every task editor: when the user changes the duration, the end time has
 * to move with it, and both the database row and the mirrored device-calendar
 * event are written from the same value — so the block drawn on the phone's
 * calendar can never disagree with the number of hours shown in the app.
 *
 * Returns `undefined` when there is no start time (an all-day task has no end),
 * or when the duration is not a usable number.
 *
 * Durations are half-hour steps but the end time is snapped to whole minutes, and
 * the clock wraps within the same day ([start, 23:59]) so a late block cannot
 * produce an end time that reads as "before" the start.
 */
export function endTimeFrom(startTime: string | undefined, durationHours: number | undefined): string | undefined {
  if (!startTime || !Number.isFinite(durationHours)) return undefined;
  const [h, m] = startTime.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
  if (!(durationHours! > 0)) return undefined;

  const startMinutes = h * 60 + m;
  const endMinutes = Math.min(startMinutes + Math.round(durationHours! * 60), 23 * 60 + 59);
  return `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
}

/** 12-hour display parts for a stored 24h "HH:MM" (or undefined → 09:00 AM do-now). */
function timeParts(value?: string): { hour12: number; minute: number; period: 'AM' | 'PM' } {
  if (!value) return { hour12: 9, minute: 0, period: 'AM' };
  const [h, m] = value.split(':').map(Number);
  const hour24 = Number.isFinite(h) ? h : 9;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    hour12,
    minute: Number.isFinite(m) ? Math.max(0, Math.min(59, m)) : 0,
    period: hour24 >= 12 ? 'PM' : 'AM',
  };
}

/** Serialize the display parts back into a 24h "HH:MM" string. */
function to24(p: { hour12: number; minute: number; period: 'AM' | 'PM' }): string {
  const hour24 = p.period === 'PM' ? (p.hour12 % 12) + 12 : p.hour12 % 12;
  return `${String(hour24).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function wrapValue(value: number, min: number, max: number): number {
  if (value < min) return max;
  if (value > max) return min;
  return value;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    minWidth: 46,
  },
  chipActive: { backgroundColor: colors.brown, borderColor: colors.brown },
  chipText: { fontSize: 11, fontWeight: '600', color: colors.inkSoft },
  chipTextActive: { color: colors.cream },
  chipSub: { fontSize: 10, color: colors.inkFaint, marginTop: 1 },

  /* TimePicker — All day chip + hour : minute + AM/PM steppers */
  timePicker: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  timeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  timeChipActive: { backgroundColor: colors.brown, borderColor: colors.brown },
  timeChipText: { fontSize: 11, fontWeight: '600', color: colors.inkSoft },
  timeChipTextActive: { color: colors.cream },
  timeSteppers: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeUnit: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  timeStepBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.yellowWash,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeStepText: { fontSize: 14, fontWeight: '700', color: colors.brown, lineHeight: 18 },
  timeValue: {
    minWidth: 22,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
  },
  timeColon: { fontSize: 14, fontWeight: '700', color: colors.inkFaint },
  periodChip: { minWidth: 46, alignItems: 'center' },
});