import type { WorkoutExercise, WorkoutRecord } from './workout.ts';

export function previousValueChanges(exercise: WorkoutExercise) {
  if (
    !exercise.lastDate ||
    !exercise.lastReps.length ||
    exercise.lastWeights.length !== exercise.lastReps.length
  ) {
    return [];
  }
  return exercise.sets.flatMap((x, index) => {
    const weight = exercise.lastWeights[index];
    const reps = exercise.lastReps[index];
    if (
      x.completedAt !== null ||
      x.startedAt !== null ||
      weight === undefined ||
      reps === undefined ||
      !Number.isFinite(weight) ||
      weight < -100 ||
      weight > 500 ||
      !Number.isInteger(reps) ||
      reps < 0 ||
      reps > 100 ||
      (exercise.exerciseType === 'weighted' && weight < 0)
    ) {
      return [];
    }
    return [
      {
        setId: x.id,
        number: index + 1,
        beforeWeight: x.weight,
        beforeReps: x.reps,
        weight: String(weight),
        reps: String(reps),
        date: exercise.lastDate,
      },
    ];
  });
}

export function reusePreviousValues(
  workout: WorkoutRecord,
  exerciseId: string,
  expected: ReturnType<typeof previousValueChanges>,
): WorkoutRecord {
  const exercise = workout.exercises.find((x) => x.id === exerciseId);
  if (
    workout.status !== 'active' ||
    workout.runningSet ||
    !exercise ||
    !expected.length ||
    JSON.stringify(previousValueChanges(exercise)) !== JSON.stringify(expected)
  ) {
    throw new Error('These sets have changed. Review the previous-value preview again.');
  }
  return {
    ...workout,
    exercises: workout.exercises.map((x) =>
      x.id !== exerciseId
        ? x
        : {
            ...x,
            sets: x.sets.map((y) => {
              const change = expected.find((z) => z.setId === y.id);
              return change ? { ...y, weight: change.weight, reps: change.reps } : y;
            }),
          },
    ),
  };
}
