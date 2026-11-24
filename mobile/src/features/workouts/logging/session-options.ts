import { budgetForPreset, type DurationPreset } from '@trainingai/shared/workout/duration-model';
import type { SessionPreview } from '../catalog.ts';

export type SessionStartOptions = {
  aiDeload?: boolean;
  fullOverride?: boolean;
  revertedExerciseIds?: string[];
  durationPreset?: DurationPreset;
};
export function prepareSession(
  session: SessionPreview,
  options: SessionStartOptions,
): SessionPreview {
  const reverted = new Set(options.revertedExerciseIds ?? []);
  return {
    ...session,
    budgetMinutes:
      options.durationPreset === undefined
        ? session.budgetMinutes
        : budgetForPreset(session.budgetMinutes ?? 60, options.durationPreset),
    exercises: session.exercises.map((exercise) =>
      exercise.deloaded &&
      exercise.preDeloadStyle?.length &&
      (options.fullOverride || reverted.has(exercise.id))
        ? {
            ...exercise,
            deloaded: false,
            sets: exercise.preDeloadStyle,
            setCount: exercise.preDeloadSets ?? exercise.preDeloadStyle.length,
          }
        : exercise,
    ),
  };
}

/**
 * What a started workout records as its type. It follows what was put in front of the lifter: a
 * session whose every row is still deloaded is a deload, even when Full was chosen over rows that
 * carry no full numbers (a plan stored before `preDeloadStyle`), and then nothing was overridden.
 */
export function recordedIntensity(
  options: SessionStartOptions,
  exercises: readonly { deloaded: boolean }[],
) {
  const allLight = exercises.length > 0 && exercises.every((exercise) => exercise.deloaded);
  const overridden = !!options.fullOverride || !!options.revertedExerciseIds?.length;
  return {
    intensityMode: options.aiDeload || allLight ? ('deload' as const) : ('full' as const),
    wasOverride: overridden && !allLight,
  };
}
