import {
  formatTime12h,
  formatTimeOfDay,
  msToHHMMInTz,
  localClockTimeToDate,
} from '@trainingai/shared/date-utils';

// What the date and time fields store and show. The stored forms are the ones the typed fields
// took: a date is `YYYY-MM-DD`, a time of day is `HH:MM` on a 24-hour clock.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar's own year range (MonthCalendar stops its arrows here). */
export const FIRST_YEAR = 2000;
export const LAST_YEAR = 2100;

/** The parts of a real calendar date (`YYYY-MM-DD`, a `/` is read too) in any year, or null. Component-wise, so no zone can shift the day. */
function dateParts(value: string | null | undefined) {
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec((value ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, text: `${m[1]}-${m[2]}-${m[3]}` };
}

/** A real calendar date inside the calendar's years as `YYYY-MM-DD`, or null. */
export function parseDateValue(value: string | null | undefined): string | null {
  const parts = dateParts(value);
  return parts && parts.year >= FIRST_YEAR && parts.year <= LAST_YEAR ? parts.text : null;
}

/** "24 Nov 2026", or null when the value is not a date. */
export function formatDateField(value: string | null | undefined): string | null {
  // Any real date reads formatted, also one the calendar cannot reach (a stored 1998 start).
  const parts = dateParts(value);
  return parts ? `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}` : null;
}

/** The month the calendar opens on: the value's, else today's. */
export function calendarMonth(value: string | null | undefined, today: string): string {
  return (parseDateValue(value) ?? parseDateValue(today) ?? today).slice(0, 7);
}

/** Whether `date` sits inside the optional inclusive bounds (all `YYYY-MM-DD`; string order is date order). */
export function dateInBounds(date: string, min?: string, max?: string): boolean {
  return (!min || date >= min) && (!max || date <= max);
}

export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** `H:MM` or `HH:MM` on a 24-hour clock, or null. */
export function parseTimeValue(value: string | null | undefined): TimeOfDay | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function toTimeValue({ hour, minute }: TimeOfDay): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Move a time of day by whole minutes, round the clock. */
export function shiftTime(time: TimeOfDay, deltaMin: number): TimeOfDay {
  const total = (((time.hour * 60 + time.minute + deltaMin) % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

/**
 * How a stored time reads: the app's one time-of-day form ("11:10 pm") through `formatTimeOfDay`,
 * as the wall-clock time on `onDate` in the profile's zone. null when the value is not a time.
 */
export function formatTimeField(
  value: string | null | undefined,
  timezone: string,
  onDate: string,
): string | null {
  const time = parseTimeValue(value);
  if (!time) return null;
  const hhmm = toTimeValue(time);
  const instant = localClockTimeToDate(onDate, hhmm, timezone);
  // A wall time the zone skips (a clock change) lands on another minute; the plain 12-hour form
  // keeps what the person set.
  return instant && msToHHMMInTz(instant, timezone) === hhmm
    ? formatTimeOfDay(instant, timezone)
    : formatTime12h(hhmm);
}
