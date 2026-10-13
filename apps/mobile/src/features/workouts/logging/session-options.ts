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
