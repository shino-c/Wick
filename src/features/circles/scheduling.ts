/**
 * Scheduling helpers for challenges.
 *
 * `scheduled_for` is a text column and always has been, because the first
 * version only ever wrote quick labels like "Tomorrow". Those rows still exist,
 * so this module has to read both: an ISO timestamp for anything picked with a
 * real date and time, and free text for everything older.
 *
 * The presets stay — "let's walk on Saturday" is a normal way to arrange
 * something — but they now resolve to an actual date and time, because a
 * meetup someone has to physically attend needs an hour attached to it, and
 * "This weekend" is not an hour.
 */

export interface ScheduleValue {
  /** ISO 8601 instant, or null for "any time". */
  iso: string | null;
  /** Legacy free text, only ever read, never written by the picker. */
  legacy: string | null;
}

const DAY_MS = 86_400_000;

export function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** The next `count` days, starting today. */
export function upcomingDays(count: number, from = new Date()): Date[] {
  const base = startOfDay(from);
  return Array.from({ length: count }, (_, i) => new Date(base.getTime() + i * DAY_MS));
}

export function combine(day: Date, minutesOfDay: number): Date {
  const d = startOfDay(day);
  d.setMinutes(minutesOfDay);
  return d;
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function formatTime(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function formatDayLabel(d: Date, today = new Date()): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(today).getTime()) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * How a schedule is shown wherever a challenge appears.
 * Falls back to the stored text for rows written before the picker existed.
 */
export function formatSchedule(stored: string | null): string {
  if (!stored) return 'Any time';
  const d = new Date(stored);
  if (Number.isNaN(d.getTime())) return stored;
  return `${formatDayLabel(d)}, ${formatTime(minutesOfDay(d))}`;
}

/** True when a stored schedule is a real instant that has already passed. */
export function isPast(stored: string | null): boolean {
  if (!stored) return false;
  const d = new Date(stored);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

/** Parses a stored value back into picker state. */
export function parseSchedule(stored: string | null): {
  day: Date | null;
  minutes: number;
  legacy: string | null;
} {
  if (!stored) return { day: null, minutes: 18 * 60, legacy: null };
  const d = new Date(stored);
  if (Number.isNaN(d.getTime())) return { day: null, minutes: 18 * 60, legacy: stored };
  return { day: startOfDay(d), minutes: minutesOfDay(d), legacy: null };
}

/** Quick presets. Each resolves to a real day, not a vague label. */
export const DAY_PRESETS: { label: string; resolve: (now: Date) => Date }[] = [
  { label: 'Today', resolve: (now) => startOfDay(now) },
  { label: 'Tomorrow', resolve: (now) => new Date(startOfDay(now).getTime() + DAY_MS) },
  {
    label: 'This weekend',
    // Saturday. If it is already the weekend, that means today or tomorrow.
    resolve: (now) => {
      const base = startOfDay(now);
      const untilSaturday = (6 - base.getDay() + 7) % 7;
      return new Date(base.getTime() + untilSaturday * DAY_MS);
    },
  },
];

/** Common meeting times, as minutes from midnight. */
export const TIME_PRESETS = [8 * 60, 12 * 60, 15 * 60, 18 * 60, 20 * 60];

export const TIME_STEP_MINUTES = 15;

export function stepTime(minutes: number, direction: 1 | -1): number {
  const next = minutes + direction * TIME_STEP_MINUTES;
  return ((next % 1440) + 1440) % 1440;
}
