import { computeRpeAdjustment } from '@trainingai/shared/ai-periodization/autoregulation';
import type { ExercisePreview, SetPreview } from '../catalog';
import type { WorkoutExercise, WorkoutRecord, WorkoutSet } from './workout';

export function weightStep(equipment: string[] = []) {
  return equipment.includes('barbell') ? 2.5 : 1.25;
}

export function roundLoad(value: number, step: number, up = false) {
  return Math.max(
    5,
    Math.min(250, (up ? Math.ceil(value / step) : Math.round(value / step)) * step),
  );
}

export function prescribedWeight(exercise: Pick<ExercisePreview, 'exerciseType' | 'estimated1rm' | 'equipment'>, planned: SetPreview | null) {
  return exercise.exerciseType === 'weighted' && exercise.estimated1rm && planned
    ? roundLoad(
        (exercise.estimated1rm * planned.percent) / 100,
        weightStep(exercise.equipment),
        true,
      )
    : null;
}

export function initialWeight(exercise: Pick<ExercisePreview, 'exerciseType' | 'estimated1rm' | 'equipment' | 'target80' | 'latestWeight'>, planned: SetPreview | null) {
  if (exercise.exerciseType === 'bodyweight') {
    return 0;
  }
  const prescribed = prescribedWeight(exercise, planned);
  const step = weightStep(exercise.equipment);
  if (prescribed !== null) {
    return prescribed;
  }
  if (exercise.target80 !== null) {
    return roundLoad(exercise.target80, step);
  }
  if (exercise.estimated1rm) {
    return roundLoad(exercise.estimated1rm * 0.8, step, true);
  }
  return exercise.latestWeight === null ? 60 : roundLoad(exercise.latestWeight, step);
}

export function expectedRpe(percent?: number) {
  return percent === undefined ? 7 : Math.min(10, Math.max(6, Math.floor(percent / 10)));
}

export function isAmrap(workout: WorkoutRecord, exercise: WorkoutExercise, index: number) {
  return (
    workout.isBaseline || (exercise.lastSetMode === 'amrap' && index === exercise.sets.length - 1)
  );
}

export function formatSetLoad(
  exercise: Pick<WorkoutExercise, 'exerciseType'>,
  set: Pick<WorkoutSet, 'weight' | 'reps'>,
) {
  if (exercise.exerciseType === 'bodyweight' && Number(set.weight) === 0) {
    return `${set.reps} reps`;
  }
  const prefix = exercise.exerciseType === 'bodyweight' && Number(set.weight) > 0 ? '+' : '';
  return `${prefix}${set.weight} kg × ${set.reps} reps`;
}

export function loadSuggestion(workout: WorkoutRecord, exercise: WorkoutExercise, set: WorkoutSet) {
  const index = exercise.sets.findIndex((item) => item.id === set.id);
  const previous = exercise.sets[index - 1];
  const weight = Number(set.weight);
  if (
    exercise.exerciseType === 'bodyweight' ||
    set.suggestionHandled ||
    set.completedAt !== null ||
    !previous?.completedAt ||
    previous.rpe === null ||
    !previous.planned?.reps ||
    !Number.isFinite(weight) ||
    weight <= 0
  ) {
    return null;
  }
  const adjustment = computeRpeAdjustment(
    {
      role: 'primary',
      rpeDelta: previous.rpe - expectedRpe(previous.planned.percent),
      rm1Trend: 'flat',
      repCompletionRate: Number(previous.reps) / previous.planned.reps,
    },
    {
      phase: workout.isBaseline ? 'baseline' : exercise.deloaded ? 'deload' : 'normal',
      currentReps: previous.planned.reps,
      band: { repMin: previous.planned.reps, repMax: previous.planned.reps },
    },
  );
  const weightKg = roundLoad(weight * adjustment.pctMultiplier, weightStep(exercise.equipment));
  return adjustment.note && adjustment.pctMultiplier < 1 && weightKg < weight
    ? { weightKg, note: adjustment.note }
    : null;
}
