import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { trainingDays } from './models';
import { trainingDaySpecs } from './training-days';

/** Home's trained days: the calendars and streak above, and the journal's completed workouts. */
export function useTrainingDays(today: string) {
  const journal = useWorkoutJournal();
  const specs = trainingDaySpecs(today);
  const calendar = useWorkoutResource(specs.calendar);
  const lastCalendar = useWorkoutResource(specs.lastCalendar);
  const streakData = useWorkoutResource(specs.streak);
  const days = trainingDays(
    [streakData.data?.trainedDays, lastCalendar.data?.trainedDays, calendar.data?.trainedDays],
    journal.data.workouts,
  );
  return { days, calendar, lastCalendar, streakData };
}
