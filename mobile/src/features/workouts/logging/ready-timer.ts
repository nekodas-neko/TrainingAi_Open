import { transitionSecForEquipment } from '@trainingai/shared/workout/duration-model';
import type { WorkoutExercise, WorkoutRecord } from './workout.ts';

/**
 * The preparation countdown an exercise's load / warm-up step shows: when it began and how long it
 * is. Null when the setup timer is off or the step has not begun, the cases where the screen shows
 * nothing. The screen and the picture-in-picture window both read it, so they cannot differ.
 */
export function readyTimer(
  workout: Pick<WorkoutRecord, 'timers'>,
  exercise: Pick<WorkoutExercise, 'readyStartedAt' | 'equipment'>,
): { startedAt: number; seconds: number } | null {
  // A record from before the timer preferences existed may carry none: no timer, as the screen.
  if (!workout.timers?.setup || exercise.readyStartedAt === null) return null;
  return {
    startedAt: exercise.readyStartedAt,
    seconds: workout.timers.setupSeconds ?? transitionSecForEquipment(exercise.equipment),
  };
}
