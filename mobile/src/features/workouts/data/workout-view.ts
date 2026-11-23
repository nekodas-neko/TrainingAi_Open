import type { WorkoutRecord } from '../logging/workout.ts';
import { setValues } from '../logging/workout.ts';
import { overlayHistory, type HistoryOperation } from './HistoryOutbox.ts';
import type { DayExercise } from './models.ts';

/**
 * The one view of finished workouts that history and every "done" mark read (#3880): the server's
 * workouts, plus the journal's finished workouts the server doesn't have yet, minus the ones
 * deleted. Preview uploads a workout at Finish, so until then only the phone has it; once it has
 * uploaded the server's copy is the record, and a workout deleted there (or exercise by exercise)
 * stops counting as done even while the phone keeps its two-week copy.
 *
 * `UPLOAD_GRACE_MS`: a workout that has just uploaded still counts from the phone for a few
 * minutes, the time the screens take to fetch the server's new copy, so its day doesn't blink to
 * "not trained" between the upload and the refetch.
 */
export const UPLOAD_GRACE_MS = 5 * 60_000;

function deletedSession(id: string, operations: readonly HistoryOperation[]) {
  return operations.some(
    (operation) =>
      operation.domain === 'workout_session_delete' && operation.payload.workoutSessionId === id,
  );
}

function deletedLog(logId: string, operations: readonly HistoryOperation[]) {
  return operations.some(
    (operation) =>
      operation.domain === 'exercise_log_delete' && operation.payload.exerciseLogId === logId,
  );
}

function recordedExercises(workout: WorkoutRecord) {
  return workout.exercises.filter((exercise) =>
    exercise.sets.some((set) => set.completedAt !== null),
  );
}

/** The journal's finished workouts the server may not have yet, less any deleted on this phone. */
export function localOnlyWorkouts(
  workouts: readonly WorkoutRecord[],
  operations: readonly HistoryOperation[],
  now: number,
): WorkoutRecord[] {
  return workouts.filter(
    (workout) =>
      workout.status === 'completed' &&
      (workout.pending.length > 0 ||
        (workout.syncedAt !== null && now - workout.syncedAt < UPLOAD_GRACE_MS)) &&
      !deletedSession(workout.id, operations) &&
      recordedExercises(workout).some((exercise) => !deletedLog(exercise.logId, operations)),
  );
}

/** A journal exercise as the day log would return it once uploaded (`/api/day-log`). */
function dayEntry(workout: WorkoutRecord, exercise: WorkoutRecord['exercises'][number]): DayExercise {
  const sets = exercise.sets.filter((set) => set.completedAt !== null);
  const values = sets.flatMap((set) => {
    try {
      return [setValues(set)];
    } catch {
      return [];
    }
  });
  return {
    name: exercise.name,
    sessionName: workout.sessionName,
    exerciseType: exercise.exerciseType,
    weightKg: values[0]?.weight ?? null,
    setWeights: values.map((value) => value.weight),
    sets: values.length || null,
    reps: values.map((value) => value.reps),
    timeToCompleteSet: null,
    loggedAt: new Date(Math.max(...sets.map((set) => set.completedAt!))).toISOString(),
    exerciseLogId: exercise.logId,
    workoutSessionId: workout.id,
  };
}

/**
 * A day's history: the server's exercises, then each exercise of a phone-only workout on that day
 * the server doesn't list, with queued edits and deletes applied to all of them.
 */
export function dayHistory(
  date: string,
  server: readonly DayExercise[],
  workouts: readonly WorkoutRecord[],
  operations: readonly HistoryOperation[],
  now: number,
): DayExercise[] {
  const day = date.replace(/\//g, '-');
  const known = new Set(server.map((entry) => entry.exerciseLogId));
  const local = localOnlyWorkouts(workouts, operations, now)
    .filter((workout) => workout.date === day)
    .flatMap((workout) =>
      recordedExercises(workout)
        .filter((exercise) => !known.has(exercise.logId))
        .map((exercise) => dayEntry(workout, exercise)),
    );
  return overlayHistory([...server, ...local], [...operations]);
}

/**
 * The session-exercise id whose logged unit applies to a history row: the id the phone's own
 * journal gave the exercise (`relogOf ?? id`, the key `preferences.units` is written under), found
 * through the row's log id. Null for a row the phone has no copy of (another phone, an old
 * session): its unit is unknown, so it stays kilograms.
 */
export function unitKeyForLog(workouts: readonly WorkoutRecord[], exerciseLogId: string) {
  for (const workout of workouts) {
    const exercise = workout.exercises.find((x) => x.logId === exerciseLogId);
    if (exercise) {
      return exercise.relogOf ?? exercise.id;
    }
  }
  return null;
}
