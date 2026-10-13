import { estimateOneRm, withPrescribedBars } from '@trainingai/shared/1rm';
import { setValues, type WorkoutExercise, type WorkoutRecord } from './workout';

export function exerciseResult(workout: WorkoutRecord, exercise: WorkoutExercise) {
  const recorded = exercise.sets.filter((set) => set.completedAt !== null);
  const values = recorded.flatMap((set) => {
    try {
      return [setValues(set)];
    } catch {
      return [];
    }
  });
  const estimate =
    values.length === recorded.length &&
    values.length &&
    (!exercise.deloaded || workout.isBaseline)
      ? estimateOneRm(
          values.map((set) => ({ weightKg: set.weight, reps: set.reps })),
          {
            exerciseType: exercise.exerciseType,
            isBaseline: workout.isBaseline,
            style: withPrescribedBars(
              recorded.every((set) => set.planned !== null)
                ? recorded.map((set) => ({
                    pct: set.planned!.percent,
                    reps: set.planned!.reps,
                    useFor1rm: set.planned!.useFor1rm,
                  }))
                : undefined,
              recorded.map((set) => set.plannedWeight),
              exercise.estimated1rm,
            ),
          },
        ).estimated1rm
      : null;
  const rated = recorded.filter((set) => set.rpeSource === 'rated' && set.rpe !== null);
  return {
    sets: recorded.length,
    reps: values.reduce((sum, set) => sum + set.reps, 0),
    loadVolume: values.reduce((sum, set) => sum + Math.max(0, set.weight) * set.reps, 0),
    estimate: estimate && estimate > 0 ? estimate : null,
    repMax:
      exercise.exerciseType === 'bodyweight' && values.length
        ? Math.max(...values.map((set) => set.reps))
        : null,
    ratedRpe: rated.length
      ? rated.reduce((sum, set) => sum + set.rpe!, 0) / rated.length
      : null,
  };
}

export function workoutResult(workout: WorkoutRecord) {
  const exercises = workout.exercises.map((exercise) => exerciseResult(workout, exercise));
  const sets = workout.exercises.flatMap((exercise) => exercise.sets);
  const timed = sets.filter((set) => set.completedAt !== null && set.startedAt !== null);
  const rests = sets.filter((set) => set.restAfterSec !== null);
  return {
    exercises: new Set(
      workout.exercises
        .filter((exercise) => exercise.sets.some((set) => set.completedAt !== null))
        .map((exercise) => exercise.relogOf ?? exercise.id),
    ).size,
    sets: exercises.reduce((sum, exercise) => sum + exercise.sets, 0),
    reps: exercises.reduce((sum, exercise) => sum + exercise.reps, 0),
    loadVolume: exercises.reduce((sum, exercise) => sum + exercise.loadVolume, 0),
    warmupSeconds:
      workout.warmupEndedAt === null
        ? null
        : Math.max(0, (workout.warmupEndedAt - workout.startedAt) / 1000),
    timedSetSeconds: timed.length
      ? timed.reduce(
          (sum, set) => sum + Math.max(0, (set.completedAt! - set.startedAt!) / 1000),
          0,
        )
      : null,
    restSeconds: rests.length ? rests.reduce((sum, set) => sum + set.restAfterSec!, 0) : null,
  };
}
