import type { WorkoutRecord } from './workout.ts';

type WorkoutStage = NonNullable<WorkoutRecord['flow']>['stage'];

/**
 * What Back does on each stage of a guided workout. `header` is the on-screen button, `system`
 * the Android Back gesture. On the summary the header button is "Continue", as in the current
 * app, but the gesture only returns to the session hub: on the last exercise "Continue" finishes
 * the workout, and a finished workout can't be reopened (#3879).
 */
export type WorkoutBack = 'next' | 'session' | 'leave';

export function workoutBack(
  stage: WorkoutStage,
  ready: boolean,
  source: 'header' | 'system',
): WorkoutBack {
  if (stage === 'summary') return source === 'header' ? 'next' : 'session';
  if (stage === 'warmup' || (stage === 'exercise' && ready)) return 'session';
  return 'leave';
}
