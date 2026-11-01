import {
  aggregateHrRecoveryByExercise,
  type SetRecoveryInput,
} from '@trainingai/shared/health/hr-recovery-by-exercise';

/** Said on a set, or an exercise, that has no usable heart rate to judge its rest by (#2299). */
export const REST_NOT_MEASURED = 'Rest not measured with this device';

/**
 * Exercises, in workout order, with no set carrying a recovery reading. The aggregate leaves
 * exactly these out, so the line they get here is the only trace of them.
 */
export function exercisesWithoutRest(sets: SetRecoveryInput[]) {
  const measured = new Set(aggregateHrRecoveryByExercise(sets).map((x) => x.exerciseName));
  return [...new Set(sets.map((x) => x.exerciseName))].filter((x) => !measured.has(x));
}
