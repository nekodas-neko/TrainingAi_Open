import type { WorkoutRecord } from './workout.ts';
import { buildSetSequence } from '@trainingai/shared/workout/superset-order';

export function supersetNext(workout: WorkoutRecord, exerciseId: string, setId: string) {
  if (workout.soloExerciseId) {
    return null;
  }
  const exercises = workout.exercises.filter((exercise) => !exercise.retired && !exercise.relogOf);
  const exerciseIndex = exercises.findIndex((exercise) => exercise.id === exerciseId);
  const current = exercises[exerciseIndex];
  if (!current || current.supersetGroup == null) {
    return null;
  }
  const sequence = buildSetSequence(
    exercises.map((exercise) => ({
      supersetGroup: exercise.supersetGroup ?? null,
      setCount: exercise.sets.length,
    })),
  );
  const completed = sequence.findIndex(
    (step) => step.exerciseIndex === exerciseIndex && current.sets[step.setIndex].id === setId,
  );
  for (const step of sequence.slice(completed + 1)) {
    const candidate = exercises[step.exerciseIndex];
    if (candidate.supersetGroup !== current.supersetGroup) {
      break;
    }
    if (candidate.sets[step.setIndex].completedAt === null) {
      return candidate;
    }
  }
  return null;
}

export function workoutFlow(workout: WorkoutRecord): NonNullable<WorkoutRecord['flow']> {
  if (workout.flow) {
    return workout.flow;
  }
  const reference = workout.runningSet ?? workout.rest;
  const exercise =
    workout.exercises.find((exercise) => exercise.id === reference?.exerciseId) ??
    workout.exercises.find((exercise) => exercise.sets.some((set) => set.completedAt === null)) ??
    workout.exercises[workout.exercises.length - 1];
  return {
    stage: exercise.sets.every((set) => set.completedAt !== null) ? 'summary' : 'exercise',
    exerciseId: exercise.id,
  };
}

export function nextExerciseFlow(workout: WorkoutRecord): NonNullable<WorkoutRecord['flow']> {
  const flow = workoutFlow(workout);
  const index = workout.exercises.findIndex((exercise) => exercise.id === flow.exerciseId);
  const next = workout.exercises
    .slice(index + 1)
    .find((exercise) => !exercise.retired && !exercise.relogOf);
  return next
    ? {
        stage: next.sets.every((set) => set.completedAt !== null) ? 'summary' : 'exercise',
        exerciseId: next.id,
      }
    : { stage: 'review', exerciseId: flow.exerciseId };
}
