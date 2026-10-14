import {
  setWorkSec,
  transitionSecForEquipment,
} from '@trainingai/shared/workout/duration-model';
import { buildSetSequence } from '@trainingai/shared/workout/superset-order';
import type { WorkoutExercise, WorkoutRecord } from './workout.ts';

export function measuredExerciseTiming(
  workout: WorkoutRecord,
  exercise: WorkoutExercise,
) {
  if (exercise.supersetGroup !== null) {
    return { prepTimeSec: null, interExerciseRestSec: null };
  }
  const firstStart = exercise.sets.find((x) => x.completedAt !== null)?.startedAt ?? null;
  const previousEnd = workout.exercises
    .filter((x) => x.id !== exercise.id)
    .flatMap((x) => x.sets)
    .map((x) => x.completedAt)
    .filter((x): x is number => x !== null && firstStart !== null && x <= firstStart)
    .sort((x, y) => y - x)[0];
  const duration = (from: number | null | undefined) =>
    from == null ||
    firstStart === null ||
    firstStart < from ||
    firstStart - from > 86_400_000
      ? null
      : Math.round((firstStart - from) / 1000);
  return {
    prepTimeSec: duration(exercise.readyStartedAt),
    interExerciseRestSec: duration(previousEnd),
  };
}

export function workoutTiming(workout: WorkoutRecord) {
  const sequence = buildSetSequence(
    workout.exercises.map((x) => ({
      supersetGroup: x.supersetGroup,
      setCount: x.sets.length,
    })),
  );
  const duration = (from: number | null | undefined, to: number | null) =>
    from == null || to === null || to < from || to - from > 86_400_000
      ? null
      : (to - from) / 1000;
  return workout.exercises.flatMap((x, exerciseIndex) => {
    const sets = x.sets.filter((y) => y.completedAt !== null);
    if (!sets.length) {
      return [];
    }
    const work = sets.map((y) => duration(y.startedAt, y.completedAt));
    const rest = sets.map((y) => y.restAfterSec);
    const sum = (values: (number | null)[]) =>
      values.some((y) => y !== null)
        ? values.reduce<number>((total, y) => total + (y ?? 0), 0)
        : null;
    const measured = measuredExerciseTiming(workout, x);
    return [
      {
        id: x.logId,
        name: x.name,
        sets,
        setupActualSec: measured.interExerciseRestSec ?? measured.prepTimeSec,
        setupExpectedSec: transitionSecForEquipment(x.equipment),
        workActualSec: sum(work),
        workMeasured: work.filter((y) => y !== null).length,
        workExpectedSec: sets.every((y) => y.planned !== null)
          ? sets.reduce((total, y) => total + setWorkSec(y.planned!.reps), 0)
          : null,
        restActualSec: sum(rest),
        restMeasured: rest.filter((y) => y !== null).length,
        restExpectedSec: sets.reduce<number | null>((total, y) => {
          const index = sequence.findIndex(
            (z) => z.exerciseIndex === exerciseIndex && x.sets[z.setIndex].id === y.id,
          );
          const next = sequence[index + 1];
          const interSet =
            next &&
            (next.exerciseIndex === exerciseIndex ||
              (x.supersetGroup !== null &&
                workout.exercises[next.exerciseIndex].supersetGroup === x.supersetGroup));
          return total === null || (interSet && y.planned === null)
            ? null
            : total + (interSet ? y.planned!.restSeconds : 0);
        }, 0),
      },
    ];
  });
}
