import { nextExerciseFlow } from './flow.ts';
import type { WorkoutRecord } from './workout.ts';

/** The words the logger shows around skipping, kept apart from the screen so they can be tested (#4143). */
export function skipExerciseMessage(
  exerciseName: string,
  /** Where skipping lands: the next exercise, or the session hub when none is left or it is a solo exercise. */
  goesTo: 'next' | 'session',
): string {
  return `Skip ${exerciseName}? Sets you have already logged on it stay saved. ${
    goesTo === 'session' ? 'You go back to the session.' : 'You move on to the next exercise.'
  }`;
}

/** Where Skip lands for this workout, the same rule `skipExercise` applies, so the words stay true on the last exercise. */
export function skipGoesTo(workout: WorkoutRecord): 'next' | 'session' {
  return workout.soloExerciseId || nextExerciseFlow(workout).stage === 'review' ? 'session' : 'next';
}
