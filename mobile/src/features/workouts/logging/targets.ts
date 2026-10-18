import {
  expectedRpePrefill,
  expectedRpe as expectedSetRpe,
} from '@trainingai/shared/ai-periodization/expected-rpe';
import { computeRpeAdjustment } from '@trainingai/shared/ai-periodization/autoregulation';
import {
  MAX_BAR_KG,
  barIsCapped,
  initialSetWeight,
  mroundStep,
  mroundStepUp,
  prescribedBar,
  weightStepFor,
} from '@trainingai/shared/workout/load-rounding';
import type { ExercisePreview, SetPreview } from '../catalog';
import type { WorkoutExercise, WorkoutRecord, WorkoutSet } from './workout';
import { displayLoad } from './preferences';

export function weightStep(equipment: string[] = []) {
  return weightStepFor(equipment);
}

export function roundLoad(value: number, step: number, up = false) {
  return up ? mroundStepUp(value, step) : mroundStep(value, step);
}

export function prescribedWeight(
  exercise: Pick<ExercisePreview, 'exerciseType' | 'estimated1rm' | 'equipment'>,
  planned: SetPreview | null,
) {
  return exercise.exerciseType === 'weighted' && planned
    ? prescribedBar(exercise.estimated1rm, planned.percent, exercise.equipment)
    : null;
}

export function initialWeight(
  exercise: Pick<
    ExercisePreview,
    'exerciseType' | 'estimated1rm' | 'equipment' | 'target80' | 'latestWeight'
  >,
  planned: SetPreview | null,
) {
  return initialSetWeight(exercise, prescribedWeight(exercise, planned));
}

export function expectedRpe(percent?: number, reps?: number) {
  return expectedRpePrefill(percent, reps);
}

export function isAmrap(
  workout: WorkoutRecord,
  exercise: WorkoutExercise,
  index: number,
) {
  return (
    workout.isBaseline ||
    (exercise.lastSetMode === 'amrap' && index === exercise.sets.length - 1)
  );
}

export function formatSetLoad(
  exercise: Pick<WorkoutExercise, 'exerciseType'>,
  set: Pick<WorkoutSet, 'weight' | 'reps'>,
) {
  if (exercise.exerciseType === 'bodyweight' && Number(set.weight) === 0) {
    return `${set.reps} reps`;
  }
  const prefix =
    exercise.exerciseType === 'bodyweight' && Number(set.weight) > 0 ? '+' : '';
  return `${prefix}${displayLoad(set.weight, 'kg')} kg × ${set.reps} reps`;
}

export function loadSuggestion(
  workout: WorkoutRecord,
  exercise: WorkoutExercise,
  set: WorkoutSet,
) {
  const index = exercise.sets.findIndex((item) => item.id === set.id);
  const previous = exercise.sets[index - 1];
  const weight = Number(set.weight);
  if (
    exercise.exerciseType === 'bodyweight' ||
    set.suggestionHandled ||
    set.completedAt !== null ||
    !previous?.completedAt ||
    previous.rpe === null ||
    previous.rpeSource !== 'rated' ||
    Number(previous.reps) <= 0 ||
    !previous.planned?.reps ||
    !Number.isFinite(weight) ||
    weight <= 0
  ) {
    return null;
  }
  const adjustment = computeRpeAdjustment(
    {
      role: 'primary',
      rpeDelta:
        previous.rpe - expectedSetRpe(previous.planned.percent, Number(previous.reps)),
      rm1Trend: 'flat',
      repCompletionRate: Number(previous.reps) / previous.planned.reps,
    },
    {
      phase: workout.isBaseline ? 'baseline' : exercise.deloaded ? 'deload' : 'normal',
      currentReps: previous.planned.reps,
      band: { repMin: previous.planned.reps, repMax: previous.planned.reps },
    },
  );
  const weightKg = roundLoad(
    weight * adjustment.pctMultiplier,
    weightStep(exercise.equipment),
  );
  return adjustment.note && adjustment.pctMultiplier < 1 && weightKg < weight
    ? { weightKg, note: adjustment.note }
    : null;
}

export function cappedTarget(
  exercise: Pick<WorkoutExercise, 'exerciseType' | 'estimated1rm' | 'equipment'>,
  set: WorkoutSet,
) {
  if (exercise.exerciseType === 'bodyweight' || !exercise.estimated1rm || !set.planned)
    return null;
  return barIsCapped((exercise.estimated1rm * set.planned.percent) / 100)
    ? MAX_BAR_KG
    : null;
}

export function loadBasis(exercise: WorkoutExercise, set: WorkoutSet) {
  if (exercise.exerciseType === 'bodyweight') {
    return 'Bodyweight reps; positive load is added weight and negative load is assistance. Strength is a rep-max estimate.';
  }
  const step = weightStep(exercise.equipment);
  const basis =
    set.plannedWeight !== null && exercise.estimated1rm !== null && set.planned
      ? `Suggested from the previous strength estimate (${exercise.estimated1rm} kg), prescribed ${set.planned.percent}%, rounded up to ${step} kg increments.`
      : exercise.target80 !== null || exercise.estimated1rm !== null
        ? `Suggested from the saved strength target, rounded to ${step} kg increments.`
        : exercise.latestWeight !== null
          ? `Starting suggestion from the last saved load (${exercise.latestWeight} kg), rounded to equipment increments.`
          : 'Default starting load; no personalised strength or previous-load basis is available. Choose a suitable load.';
  return `${basis} Your edits change this workout's entered load; the original prescription stays saved.`;
}
