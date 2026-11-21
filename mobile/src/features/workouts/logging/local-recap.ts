import { buildRecapFacts } from '@trainingai/shared/workout/session-recap';
import { recapText } from '@trainingai/shared/workout/recap-text';
import { sessionActiveMin } from '@trainingai/shared/workout/active-duration';
import type { ExerciseLog, WorkoutSession } from '@trainingai/shared/types/log';
import { setValues, type WorkoutRecord } from './workout.ts';
import { exerciseVolume, personalRecordNames } from './summary.ts';

/**
 * The done screen's recap from the phone's copy of a workout (#3880), for while its upload is
 * pending. The server writes its recap with the same two functions (`recap/route.ts`); the phone
 * knows less around them: recent sessions of this type only as far as the journal keeps them, and
 * records as the summary counted them.
 */
export function localRecap(workout: WorkoutRecord, journal: readonly WorkoutRecord[]): string | null {
  if (workout.status !== 'completed' || workout.completedAt === null) return null;
  const exercises: ExerciseLog[] = workout.exercises.flatMap((exercise) => {
    const sets = exercise.sets.filter((set) => set.completedAt !== null);
    const values = sets.flatMap((set) => {
      try {
        return [{ set, value: setValues(set) }];
      } catch {
        return [];
      }
    });
    if (!values.length) return [];
    return [
      {
        id: exercise.logId,
        workoutSessionId: workout.id,
        exerciseName: exercise.name,
        styleId: exercise.styleId ?? undefined,
        volume: exerciseVolume(
          values.map(({ value }) => value.weight),
          values.map(({ value }) => value.reps),
        ),
        muscleGroups: exercise.muscles,
        loggedAt: new Date(Math.max(...sets.map((set) => set.completedAt!))),
        sets: values.map(({ set, value }, index) => ({
          id: set.id,
          exerciseLogId: exercise.logId,
          setNumber: index + 1,
          weightKg: value.weight,
          reps: value.reps,
          useFor1rm: set.planned?.useFor1rm ?? true,
          restTimeSec: set.restAfterSec ?? undefined,
          plannedRestSec: set.planned?.restSeconds,
          rpe: set.rpe ?? undefined,
          rpeSource: set.rpeSource ?? undefined,
        })),
      },
    ];
  });
  const session: WorkoutSession = {
    id: workout.id,
    userId: '',
    sessionId: workout.sessionId,
    sessionName: workout.sessionName,
    startedAt: new Date(workout.startedAt),
    completedAt: new Date(workout.completedAt),
    exercises,
    isEarlyDeload: false,
    wasOverride: workout.wasOverride,
    intensityMode: workout.intensityMode,
    sessionRpe: null,
    pausedSec: workout.pausedMs > 0 ? Math.round(workout.pausedMs / 1000) : null,
  };
  // The server takes the last six of this session type; the phone has those it still keeps.
  const recentDurationsMin = journal
    .filter(
      (other) =>
        other.id !== workout.id &&
        other.sessionId === workout.sessionId &&
        other.status === 'completed' &&
        other.completedAt !== null,
    )
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 6)
    .map((other) =>
      sessionActiveMin(
        new Date(other.startedAt),
        new Date(other.completedAt!),
        other.pausedMs > 0 ? other.pausedMs / 1000 : null,
      ),
    );
  return recapText(
    buildRecapFacts({
      session,
      recentDurationsMin,
      restSecByStyleSet: new Map(),
      prCount: personalRecordNames(workout).length,
    }),
  );
}
