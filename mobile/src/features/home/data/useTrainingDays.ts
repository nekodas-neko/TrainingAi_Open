import { shiftDateStr } from '@trainingai/shared/date-utils';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { calendarSpec, streakDataSpec } from '../../workouts/data/models';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { trainingDays } from './models';

/** Home's trained days: this month's and last month's calendars, the streak and the journal. */
export function useTrainingDays(today: string) {
  const journal = useWorkoutJournal();
  const [year, month] = today.split('-').map(Number);
  const previous = shiftDateStr(today.slice(0, 7) + '-01', -1)
    .split('-')
    .map(Number);
  const calendar = useWorkoutResource(calendarSpec(year, month));
  const lastCalendar = useWorkoutResource(calendarSpec(previous[0], previous[1]));
  const streakData = useWorkoutResource(streakDataSpec);
  const days = trainingDays(
    [streakData.data?.trainedDays, lastCalendar.data?.trainedDays, calendar.data?.trainedDays],
    journal.data.workouts,
  );
  return { days, calendar, lastCalendar, streakData };
}
