import { z } from 'zod';
import { DEFAULT_TZ, toAestDay, isCalendarDate } from '@trainingai/shared/date-utils';
import { LogExercisePayloadSchema } from '@trainingai/shared/workout/log-payload';
import { CompleteWorkoutPayloadSchema } from '@trainingai/shared/workout/complete-payload';
import type { PendingWrite } from '../../../core/sync/pushMutation.ts';
import type { CatalogIdentity, SessionPreview } from '../catalog.ts';
import { measuredExerciseTiming } from './timing.ts';
import { expectedRpe, initialWeight, prescribedWeight } from './targets.ts';
import {
  defaultTimers,
  defaultWorkoutPreferences,
  timerPreferencesSchema,
  workoutPreferencesSchema,
} from './preferences.ts';
import { warmupBudgetMin } from '@trainingai/shared/workout/duration-model';

const timestamp = z.number().int().min(1_600_000_000_000).max(4_100_000_000_000);
const plannedSet = z.object({
  number: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative(),
  percent: z.number().nonnegative(),
  restSeconds: z.number().nonnegative(),
  useFor1rm: z.boolean().optional(),
});
const setSchema = z.object({
  id: z.uuid(),
  weight: z.string().max(20),
  reps: z.string().max(4),
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  restAfterSec: z.number().int().min(0).max(86_400).nullable(),
  planned: plannedSet.nullable(),
  plannedWeight: z.number().min(0).max(500).nullable().default(null),
  rpe: z.number().int().min(5).max(10).nullable().default(null),
  rpeSource: z.enum(['expected', 'rated']).nullable().default(null),
  suggestionHandled: z.boolean().default(false),
});
const exerciseSchema = z.object({
  id: z.uuid(),
  logId: z.uuid(),
  name: z.string().min(1).max(200),
  muscles: z.array(z.string()),
  style: z.string().nullable(),
  instructions: z.string().nullable(),
  exerciseType: z.enum(['weighted', 'bodyweight']),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']).nullable().default(null),
  deloaded: z.boolean(),
  lastWeights: z.array(z.number().min(-100).max(500)),
  equipment: z.array(z.string()).default([]),
  estimated1rm: z.number().nonnegative().nullable().default(null),
  target80: z.number().min(-100).max(500).nullable().default(null),
  latestWeight: z.number().min(-100).max(500).nullable().default(null),
  lastSetMode: z.enum(['amrap', 'plus1']).nullable().default(null),
  mainMuscles: z.array(z.string()).default([]),
  secondaryMuscles: z.array(z.string()).default([]),
  lastReps: z.array(z.number().int().nonnegative()).default([]),
  lastDate: z.string().nullable().default(null),
  prevRepMaxReps: z.number().int().nonnegative().nullable().default(null),
  readyStartedAt: timestamp.nullable().default(null),
  weightUnit: z.enum(['kg', 'lb']).default('kg'),
  supersetGroup: z.number().int().nonnegative().nullable().default(null),
  relogOf: z.uuid().nullable().default(null),
  retired: z.boolean().default(false),
  skipped: z.boolean().default(false),
  sets: z.array(setSchema).min(1).max(20),
});
const reference = z.object({ exerciseId: z.uuid(), setId: z.uuid() });
const workoutSchema = z.object({
  id: z.uuid(),
  programId: z.uuid(),
  sessionId: z.uuid(),
  sessionName: z.string().min(1).max(200),
  timezone: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isCalendarDate),
  phase: z.string().nullable(),
  phaseDetail: z.string().nullable().default(null),
  isBaseline: z.boolean(),
  fromSavedPlan: z.boolean(),
  startedAt: timestamp,
  warmupEndedAt: timestamp.nullable().default(null),
  warmupGoalSeconds: z.number().int().positive().default(600),
  warmupGoalSource: z.enum(['budget', 'default', 'selected']).default('default'),
  timers: timerPreferencesSchema.default(defaultTimers),
  restAnchor: reference.extend({ startedAt: timestamp }).nullable().default(null),
  restAdjustmentSeconds: z.number().int().min(-86400).max(86400).default(0),
  soloExerciseId: z.uuid().nullable().default(null),
  hubReturnStage: z.enum(['warmup', 'exercise', 'summary']).nullable().default(null),
  intensityMode: z.enum(['full', 'deload']).default('full'),
  wasOverride: z.boolean().default(false),
  flow: z
    .object({
      stage: z.enum(['warmup', 'exercise', 'summary', 'review']),
      exerciseId: z.uuid(),
    })
    .optional(),
  completedAt: timestamp.nullable(),
  status: z.enum(['active', 'completed', 'discarded']),
  exercises: z.array(exerciseSchema).min(1),
  runningSet: reference.nullable(),
  rest: reference.extend({ startedAt: timestamp, endsAt: timestamp }).nullable(),
  pending: z.array(
    z.object({
      id: z.uuid(),
      domain: z.enum(['workout_log', 'complete_workout']),
      exerciseId: z.uuid().optional(),
    }),
  ),
  syncedAt: timestamp.nullable(),
  syncError: z.string().nullable(),
});
const journalSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  userId: z.string(),
  workouts: z.array(workoutSchema),
  preferences: workoutPreferencesSchema.default(defaultWorkoutPreferences),
});
export type WorkoutRecord = z.infer<typeof workoutSchema>;
export type WorkoutExercise = z.infer<typeof exerciseSchema>;
export type WorkoutSet = z.infer<typeof setSchema>;
export type WorkoutJournal = z.infer<typeof journalSchema>;

export function emptyJournal(identity: CatalogIdentity): WorkoutJournal {
  return {
    version: 1,
    origin: identity.origin,
    userId: identity.userId,
    workouts: [],
    preferences: defaultWorkoutPreferences(),
  };
}

export function readJournal(
  raw: string | null,
  identity: CatalogIdentity,
): WorkoutJournal {
  if (raw === null) {
    return emptyJournal(identity);
  }
  const saved = journalSchema.parse(JSON.parse(raw));
  if (saved.origin !== identity.origin || saved.userId !== identity.userId) {
    throw new Error('Workout storage belongs to a different account.');
  }
  if (saved.workouts.filter((workout) => workout.status === 'active').length > 1) {
    throw new Error('Multiple active workouts in storage.');
  }
  const identities = new Set<string>();
  for (const workout of saved.workouts) {
    if (
      workout.flow &&
      !workout.exercises.some((exercise) => exercise.id === workout.flow!.exerciseId)
    ) {
      throw new Error('Missing saved workout exercise.');
    }
    for (const id of [
      workout.id,
      ...workout.exercises.flatMap((exercise) => [
        exercise.logId,
        ...exercise.sets.map((set) => set.id),
      ]),
    ]) {
      if (identities.has(id)) {
        throw new Error('Duplicate workout log identity.');
      }
      identities.add(id);
    }
    if (workout.status === 'completed') {
      if (workout.completedAt === null || workout.completedAt < workout.startedAt) {
        throw new Error('Invalid workout completion.');
      }
      workout.pending.forEach((item) => mutationFor(workout, item));
      const expected = finishWorkout(
        { ...workout, status: 'active', runningSet: null },
        workout.completedAt,
      ).pending;
      const suffix = expected.slice(expected.length - workout.pending.length);
      if (
        workout.pending.length > expected.length ||
        workout.pending.some(
          (item, index) =>
            item.id !== suffix[index]?.id ||
            item.domain !== suffix[index]?.domain ||
            item.exerciseId !== suffix[index]?.exerciseId,
        )
      ) {
        throw new Error('Invalid saved upload order.');
      }
      if (
        (workout.pending.length === 0) !== (workout.syncedAt !== null) ||
        workout.runningSet ||
        workout.rest
      ) {
        throw new Error('Invalid saved upload status.');
      }
    } else if (workout.pending.length || workout.completedAt !== null) {
      throw new Error('Invalid pending workout writes.');
    }
    for (const ref of [workout.runningSet, workout.rest, workout.restAnchor]) {
      if (
        ref &&
        !workout.exercises.some(
          (exercise) =>
            exercise.id === ref.exerciseId &&
            exercise.sets.some((set) => set.id === ref.setId),
        )
      ) {
        throw new Error('Missing saved workout set.');
      }
    }
  }
  return saved;
}

export function createWorkout(
  session: SessionPreview,
  programId: string,
  timezone: string | null,
  fromSavedPlan: boolean,
  now: number,
  uuid: () => string,
): WorkoutRecord {
  if (session.prescriptionPending) {
    throw new Error(
      'The session prescription is still being prepared. Check again shortly.',
    );
  }
  const tz = timezone ?? DEFAULT_TZ;
  const parsed = workoutSchema.safeParse({
    id: uuid(),
    programId,
    sessionId: session.id,
    sessionName: session.name,
    timezone: tz,
    date: toAestDay(new Date(now), tz),
    phase: session.phase,
    phaseDetail: session.phaseDetail ?? session.phase,
    isBaseline: session.isBaseline,
    fromSavedPlan,
    startedAt: now,
    warmupEndedAt: null,
    warmupGoalSeconds:
      session.budgetMinutes && session.budgetMinutes > 0
        ? Math.max(1, warmupBudgetMin(session.budgetMinutes)) * 60
        : 600,
    warmupGoalSource:
      session.budgetMinutes && session.budgetMinutes > 0 ? 'budget' : 'default',
    flow: { stage: 'warmup', exerciseId: session.exercises[0]?.id },
    completedAt: null,
    status: 'active',
    runningSet: null,
    rest: null,
    restAnchor: null,
    pending: [],
    syncedAt: null,
    syncError: null,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      logId: uuid(),
      sets: Array.from({ length: exercise.setCount }, (_, index) => {
        const planned = exercise.sets[index] ?? null;
        return {
          id: uuid(),
          weight: String(initialWeight(exercise, planned)),
          reps: String(
            (planned?.reps ?? 8) +
              (exercise.lastSetMode && index === exercise.setCount - 1 ? 1 : 0),
          ),
          startedAt: null,
          completedAt: null,
          restAfterSec: null,
          planned,
          plannedWeight: prescribedWeight(exercise, planned),
          rpe: expectedRpe(
            exercise.exerciseType === 'weighted' ? planned?.percent : undefined,
            planned?.reps,
          ),
          rpeSource: 'expected',
        };
      }),
    })),
  });
  if (!parsed.success) {
    throw new Error(
      'This session cannot be logged yet. Refresh its prescription and try again.',
    );
  }
  return parsed.data;
}

export function setValues(set: WorkoutSet) {
  const weight = set.weight.trim().replace(',', '.');
  const reps = set.reps.trim();
  if (!/^-?\d+(\.\d+)?$/.test(weight) || !/^\d+$/.test(reps)) {
    throw new Error('Enter a weight and whole-number repetitions for each recorded set.');
  }
  const parsed = LogExercisePayloadSchema.pick({ weights: true, reps: true }).safeParse({
    weights: [Number(weight)],
    reps: [Number(reps)],
  });
  if (!parsed.success) {
    throw new Error('Use weights from −100 to 500 kg and repetitions from 0 to 100.');
  }
  return { weight: parsed.data.weights[0], reps: parsed.data.reps[0] };
}

export function recordedSets(workout: WorkoutRecord) {
  return workout.exercises.flatMap((exercise) =>
    exercise.sets.filter((set) => set.completedAt !== null),
  );
}

function prefix<T, R>(values: T[], read: (value: T) => R | null): R[] {
  const result: R[] = [];
  for (const value of values) {
    const item = read(value);
    if (item === null) {
      break;
    }
    result.push(item);
  }
  return result;
}

export function mutationFor(
  workout: WorkoutRecord,
  item: WorkoutRecord['pending'][number],
): PendingWrite {
  if (item.domain === 'complete_workout') {
    return {
      id: item.id,
      domain: item.domain,
      date: workout.date,
      payload: CompleteWorkoutPayloadSchema.parse({
        workoutSessionId: workout.id,
        completedAtMs: workout.completedAt,
      }),
    };
  }
  const exercise = workout.exercises.find((exercise) => exercise.id === item.exerciseId);
  if (!exercise) {
    throw new Error('Missing queued exercise.');
  }
  const sets = exercise.sets.filter((set) => set.completedAt !== null);
  const values = sets.map(setValues);
  const styles = prefix(sets, (set) => set.planned);
  const starts = prefix(sets, (set) => set.startedAt);
  const times = prefix(sets, (set) =>
    set.startedAt === null ||
    set.completedAt! < set.startedAt ||
    set.completedAt! - set.startedAt > 86_400_000
      ? null
      : Math.round((set.completedAt! - set.startedAt) / 1000),
  );
  const rests = prefix(sets, (set) => set.restAfterSec);
  const rpeValues = prefix(sets, (set) => set.rpe);
  const plannedWeights = sets.map((set) => set.plannedWeight);
  const measured = measuredExerciseTiming(workout, exercise);
  const payload = LogExercisePayloadSchema.parse({
    ...(exercise.supersetGroup == null
      ? {
          prepTimeSec: measured.prepTimeSec ?? undefined,
          interExerciseRestSec: measured.interExerciseRestSec ?? undefined,
        }
      : {}),
    sessionName: workout.sessionName,
    sessionId: workout.sessionId,
    workoutSessionId: workout.id,
    exerciseLogId: exercise.logId,
    setLogIds: sets.map((set) => set.id),
    exercise: exercise.name,
    weights: values.map((value) => value.weight),
    reps: values.map((value) => value.reps),
    sets: sets.length,
    localDate: workout.date,
    workoutStartedAt: workout.startedAt,
    ...(workout.warmupEndedAt == null ? {} : { warmupEndedAtMs: workout.warmupEndedAt }),
    setEndTimes: sets.map((set) => set.completedAt!),
    ...(starts.length ? { setStartTimes: starts } : {}),
    ...(times.length ? { setTimes: times } : {}),
    ...(rests.length ? { restTimes: rests } : {}),
    ...(rpeValues.length
      ? {
          rpeValues,
          rpeSources: sets.slice(0, rpeValues.length).map((set) => set.rpeSource),
        }
      : {}),
    ...(plannedWeights.some((weight) => weight !== null)
      ? {
          plannedWeights,
          ...(exercise.estimated1rm && exercise.estimated1rm <= 1000
            ? { prescriptionBasisKg: exercise.estimated1rm }
            : {}),
        }
      : {}),
    ...(styles.length
      ? {
          progressionStyle: styles.map((set) => ({
            pct: set.percent,
            reps: set.reps,
            restSec: set.restSeconds,
            ...(set.useFor1rm === undefined ? {} : { useFor1rm: set.useFor1rm }),
          })),
        }
      : {}),
    ...(exercise.style === null ? {} : { styleName: exercise.style }),
    muscleGroups: exercise.muscles,
    exerciseDeloaded: exercise.deloaded,
    intensityMode: workout.intensityMode,
    wasOverride: workout.wasOverride,
  });
  return { id: item.id, domain: item.domain, date: workout.date, payload };
}

export function finishWorkout(workout: WorkoutRecord, now: number): WorkoutRecord {
  if (workout.status !== 'active') {
    throw new Error('This workout is already finished.');
  }
  if (workout.runningSet) {
    throw new Error('Record the running set before finishing.');
  }
  if (!recordedSets(workout).length) {
    throw new Error('Record at least one set before finishing.');
  }
  const completed: WorkoutRecord = {
    ...endRest(workout, now),
    status: 'completed',
    completedAt: Math.max(
      workout.startedAt,
      now,
      ...recordedSets(workout).map((set) => set.completedAt!),
    ),
    rest: null,
    restAnchor: null,
    pending: [
      ...workout.exercises
        .filter((exercise) => exercise.sets.some((set) => set.completedAt !== null))
        .map((exercise) => ({
          id: exercise.logId,
          domain: 'workout_log' as const,
          exerciseId: exercise.id,
        })),
      { id: workout.id, domain: 'complete_workout' },
    ],
  };
  completed.pending.forEach((item) => mutationFor(completed, item));
  return completed;
}

export function endRest(
  workout: WorkoutRecord,
  now: number,
  measured = true,
): WorkoutRecord {
  const rest = workout.rest ?? workout.restAnchor;
  if (!rest) {
    return workout;
  }
  const elapsed = Math.round((now - rest.startedAt) / 1000);
  return {
    ...workout,
    rest: null,
    restAnchor: null,
    exercises: workout.exercises.map((exercise) =>
      exercise.id !== rest.exerciseId
        ? exercise
        : {
            ...exercise,
            sets: exercise.sets.map((set) =>
              set.id !== rest.setId
                ? set
                : {
                    ...set,
                    restAfterSec:
                      measured && elapsed >= 0 && elapsed <= 86_400 ? elapsed : null,
                  },
            ),
          },
    ),
  };
}
