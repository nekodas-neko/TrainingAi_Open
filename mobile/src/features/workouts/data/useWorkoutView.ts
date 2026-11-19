import { useMemo } from 'react';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { useHistoryQueue } from './HistoryQueueProvider';
import { localOnlyWorkouts } from './workout-view';

/** The journal's finished workouts the server doesn't have yet (#3880), for the "done" marks. */
export function useLocalOnlyWorkouts() {
  const journal = useWorkoutJournal();
  const queue = useHistoryQueue();
  return useMemo(
    () => localOnlyWorkouts(journal.data.workouts, queue.operations, Date.now()),
    [journal.data.workouts, queue.operations],
  );
}
