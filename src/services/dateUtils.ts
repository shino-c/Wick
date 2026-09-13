/**
 * Local-timezone-safe date string helpers.
 *
 * The codebase once used `new Date().toISOString().slice(0, 10)` everywhere,
 * which converts local time to UTC before slicing the date off. For any
 * timezone not on UTC that shifts a whole day: an 8am event in UTC+8 became
 * "yesterday", and the week-start keys used to fetch today's tasks disagreed
 * with the keys the calendar sync had actually written. The result: a user
 * with a full calendar could be told they were free all day.
 *
 * These helpers format the date as the user actually sees it, so every writer
 * (calendar sync, AI analysis) and every reader (recovery plans, home, …)
 * agrees on what "today" and "this week" mean.
 */

/** Local calendar date, e.g. "2026-09-10". Never shifts to UTC. */
export function toISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's local calendar date, as the app's "YYYY-MM-DD" keys expect. */
export const todayISO = () => toISODate();

/** Short local weekday for an ISO calendar date, e.g. "Mon" or "Tue". */
export function formatWeekday(isoDate?: string): string | null {
  if (!isoDate) return null;
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

/** Keep task-card times at minute precision, e.g. "09:05". */
export function formatTaskTime(time?: string | null): string | null {
  if (!time) return null;
  const match = time.match(/^(\d{1,2}:\d{2})/);
  return match?.[1] ?? time;
}