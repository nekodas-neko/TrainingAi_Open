import { shiftDateStr } from '@trainingai/shared/date-utils';
import { calendarSpec, streakDataSpec } from '../../workouts/data/models.ts';

/** The resources Home's trained days come from: this month's and last month's calendars, the streak. */
export function trainingDaySpecs(today: string) {
  const [year, month] = today.split('-').map(Number);
  const previous = shiftDateStr(today.slice(0, 7) + '-01', -1)
    .split('-')
    .map(Number);
  return {
    calendar: calendarSpec(year, month),
    lastCalendar: calendarSpec(previous[0], previous[1]),
    streak: streakDataSpec,
  };
}
