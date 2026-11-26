import { shiftDateStr, weekStartForDay } from '@trainingai/shared/date-utils';
import type { HeartHealthActivity } from '@trainingai/shared/running/heart-health';
import {
  OUTCOME_LABEL,
  activityLine,
  shownActivity,
} from '@trainingai/shared/running/heart-health-copy';
import { weekDayOutcome, type HeartHealthDay } from './cardio-view';

// The Cardio Hub's "This week" list and the words under each row (#4100, #4158). The server sends
// only the days that have a cardio prescription row, and a row is made on a day the hub is opened,
// so a day can be missing; the list fills it here. Counting is the server's and is not touched.

const iso = (date: string) => date.replace(/\//g, '-');

export interface WeekRow {
  date: string;
  /** The server's day, or null when it has no row for this date. */
  day: HeartHealthDay | null;
}
/** Every date from this week's Monday to `today` (the profile's local day), oldest first. */
export function weekRows(days: readonly HeartHealthDay[], today: string): WeekRow[] {
  const end = iso(today);
  const byDate = new Map(days.map((day) => [iso(day.date), day]));
  const rows: WeekRow[] = [];
  for (let date = weekStartForDay(end); date <= end; date = shiftDateStr(date, 1)) {
    rows.push({ date, day: byDate.get(date) ?? null });
  }
  return rows;
}

const min = (value: number) => `${Math.round(value)} min`;
/** Why one session counted what it did, in its own minutes. */
export function sessionWhy(activity: Pick<HeartHealthActivity, 'durationMin' | 'effortMin'>): string {
  const { effortMin, durationMin } = activity;
  const total = durationMin != null && durationMin > 0 ? Math.round(durationMin) : null;
  if (effortMin == null) return 'No heart rate recorded';
  if (effortMin <= 0) {
    return total ? `${total} min, all below moderate effort` : 'All below moderate effort';
  }
  if (total != null && effortMin < total) {
    return `${Math.round(effortMin)} of ${total} min at moderate effort or above`;
  }
  return `${min(effortMin)} at moderate effort or above`;
}

/** The small line under a day's row: its one session's why, or the day's total over several. */
export function dayWhy(day: Pick<HeartHealthDay, 'activities' | 'countedMin'>): string {
  const { activities } = day;
  if (activities.length === 0) return '';
  if (activities.length === 1) return sessionWhy(activities[0]);
  if (!activities.some((a) => a.effortMin != null)) return 'No heart rate recorded';
  const across = `across ${activities.length} activities`;
  return day.countedMin > 0
    ? `${day.countedMin} min at moderate effort or above ${across}`
    : `All below moderate effort ${across}`;
}

export const ANY_ACTIVITY_COUNTS = 'Any activity counts for its minutes at moderate effort or above';
/** The floor, said once on the card; null when the server did not send one. */
export function floorLine(floorBpm: number | null | undefined): string | null {
  return floorBpm != null && Number.isFinite(floorBpm) && floorBpm > 0
    ? `Moderate starts at ${Math.round(floorBpm)} bpm for you`
    : null;
}

/**
 * What one row of the week list says. A day with no activity reads "No activity logged" and
 * nothing more: the outcome label would repeat it. Today keeps its marker.
 */
export function weekRowView(
  { date, day }: WeekRow,
  today: string,
): { line: string; sub: string; label: string | null; outcome: ReturnType<typeof weekDayOutcome> } {
  const outcome = day
    ? weekDayOutcome(day, today)
    : date === iso(today)
      ? 'today'
      : 'nothing-logged';
  const shown = day ? shownActivity(day.activities, day.creditedId) : null;
  return {
    line: shown ? activityLine(shown) : 'No activity logged',
    sub: day ? dayWhy(day) : '',
    label: !shown && outcome === 'nothing-logged' ? null : OUTCOME_LABEL[outcome],
    outcome,
  };
}
