/**
 * taskPickers.tsx — Shared chip pickers used by the task edit modals on Home
 * and Baseline.
 *
 * Each picker shows tappable preset chips (week-days / time slots) alongside an
 * "Other…" chip that opens a free-text fallback, so uncommon dates or times
 * never force the user to scroll through a raw TextInput. The fallback only
 * commits when the typed value matches the expected format.
 */

import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '@/theme';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Common start-time slots, 24h "HH:MM". "All Day" is treated as empty. */
export const PRESET_TIMES = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00',
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
 * Mon–Sun of the current week as tappable chips, plus an "Other…" chip that
 * reveals a YYYY-MM-DD text fallback (auto-opens when the value is outside
 * the current week, e.g. a deferred next-week date).
 */
export function DateChipPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const weekDates = getCurrentWeekDates();
  const notInWeek = !!value && !weekDates.includes(value);
  const showFallback = open || notInWeek;

  const toggleFallback = () => {
    const next = !showFallback;
    setOpen(next);
    if (next && !notInWeek) setDraft(value ?? '');
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.row}>
          {weekDates.map((iso, i) => {
            const d = new Date(iso + 'T00:00:00');
            const isSelected = value === iso && !showFallback;
            return (
              <Pressable
                key={iso}
                onPress={() => {
                  onChange(iso);
                  setOpen(false);
                }}
                style={[styles.chip, isSelected && styles.chipActive]}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                  {DAY_NAMES[i]}
                </Text>
                <Text
                  style={[styles.chipSub, isSelected && styles.chipTextActive]}
                >
                  {d.getDate()}/{d.getMonth() + 1}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={toggleFallback}
            style={[styles.chip, showFallback && styles.chipActive]}
          >
            <Text style={[styles.chipText, showFallback && styles.chipTextActive]}>
              Other…
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {showFallback && (
        <TextInput
          style={styles.fallbackInput}
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            if (ISO_DATE_RE.test(text)) onChange(text);
          }}
          placeholder="e.g. 2026-09-18"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          scrollEnabled={false}
        />
      )}
    </View>
  );
}
/**
 * Common start-time slots as tappable chips, plus an "Other…" chip that
 * reveals an HH:MM text fallback (auto-opens when the current time isn't one
 * of the presets, e.g. 06:30).
 */
export function TimeChipPicker({
  value,
  onChange,
}: {
  value?: string;
  /** Receives a 24h "HH:MM" string, or undefined for "All Day". */
  onChange: (time: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  const cur = value || '';
  const inPreset = PRESET_TIMES.includes(cur);
  const showFallback = open || (!!value && !inPreset);

  const toggleFallback = () => {
    const next = !showFallback;
    setOpen(next);
    if (next && inPreset) setDraft(value ?? '');
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.row}>
          {(['All Day', ...PRESET_TIMES] as const).map((t) => {
            const val = t === 'All Day' ? '' : t;
            const isSelected = t === 'All Day'
              ? !cur && !showFallback
              : cur === val && !showFallback;
            const label =
              t === 'All Day'
                ? t
                : (() => {
                    const h = parseInt(t.split(':')[0], 10);
                    return h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
                  })();
            return (
              <Pressable
                key={t}
                onPress={() => {
                  onChange(val || undefined);
                  setOpen(false);
                }}
                style={[styles.chip, isSelected && styles.chipActive]}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={toggleFallback}
            style={[styles.chip, showFallback && styles.chipActive]}
          >
            <Text style={[styles.chipText, showFallback && styles.chipTextActive]}>
              Other…
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {showFallback && (
        <TextInput
          style={styles.fallbackInput}
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            if (ISO_TIME_RE.test(text)) onChange(text);
          }}
          placeholder="e.g. 06:30"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          scrollEnabled={false}
        />
      )}
    </View>
  );
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
  fallbackInput: {
    height: 36,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: colors.ink,
    marginTop: 8,
  },
});