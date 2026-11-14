import { beatsPersonalRecord, estimateOneRm, withPrescribedBars } from '@trainingai/shared/1rm';
import { computeSetAggregates } from '@trainingai/shared/workout/set-aggregates';
import { setValues, type WorkoutExercise, type WorkoutRecord } from './workout';

/**
 * One exercise's volume in kg, as the server stores it: `computeSetAggregates`, rounded to 0.1.
 * The finish screen and the history list both read this, so they show the figure that is saved
 * (#3756). An assisted set's negative weight subtracts, because that is what the stored figure does.
 */
export function exerciseVolume(weights: readonly number[], reps: readonly number[]) {
  return weights.length && reps.length ? computeSetAggregates([...weights], [...reps]).volume : 0;
}

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
    loadVolume: exerciseVolume(
      values.map((set) => set.weight),
      values.map((set) => set.reps),
    ),
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

/**
 * #3671. Whether this exercise's estimate is a new personal record, as the current app's exercise
 * summary badge decides it (`beatsPersonalRecord`, against the all-time record the catalog
 * carried). A deloaded exercise has no estimate, and a deload session's sets never count, baseline
 * excepted, as the server's own record gate.
 */
export function newPersonalRecord(workout: WorkoutRecord, exercise: WorkoutExercise): boolean {
  if (workout.intensityMode === 'deload' && !workout.isBaseline) return false;
  return beatsPersonalRecord(
    exerciseResult(workout, exercise).estimate,
    exercise.allTimePr1rm,
    exercise.estimated1rm,
  );
}

/** The done screen's "Personal Records": each exercise that set one, once, in session order. */
export function personalRecordNames(workout: WorkoutRecord): string[] {
  return [
    ...new Set(
      workout.exercises
        .filter((exercise) => newPersonalRecord(workout, exercise))
        .map((exercise) => exercise.name),
    ),
  ];
}

/** The share line for one record, as the current app writes it (`done-screen.tsx`). */
export function personalRecordShareText(name: string) {
  return `🏆 New personal record on ${name}! #TrainingAI`;
}

/** The line the workout's own share adds when it set records, as the current app writes it. */
export function personalRecordsLine(names: readonly string[]) {
  return names.length ? `🏆 New PRs: ${names.join(', ')}` : null;
}
