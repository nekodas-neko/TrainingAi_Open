import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import { effectiveRestSec } from '@trainingai/shared/workout/rest-target';
import { pushMutation } from '../../../core/sync/pushMutation.ts';
import { ApiError } from '../../account/api/client.ts';
import type { AccountConnection } from '../../account/session.ts';
import { readSessionResponse, type SessionPreview } from '../catalog.ts';
import { nextExerciseFlow, supersetNext, workoutFlow } from './flow.ts';
import {
  expectedRpe,
  initialWeight,
  loadSuggestion,
  prescribedWeight,
} from './targets.ts';
import { timerPreferencesSchema, type TimerPreferences } from './preferences.ts';
import { previousValueChanges, reusePreviousValues } from './reuse.ts';
import { prepareSession, type SessionStartOptions } from './session-options.ts';
import {
  createWorkout,
  emptyJournal,
  endRest,
  finishWorkout,
  mutationFor,
  pauseWorkout,
  readJournal,
  resumeWorkout,
  setValues,
  type WorkoutJournal,
  type WorkoutRecord,
  type WorkoutSet,
} from './workout.ts';
import { failureNotice, reportError } from '../../../core/reporting/index.ts';

export const PROGRAM_AS_WRITTEN =
  'Your AI coach could not prepare this session, so it starts from your program as written.';

export type JournalState = {
  data: WorkoutJournal;
  ready: boolean;
  busy: boolean;
  syncing: boolean;
  saveStatus: 'saved' | 'saving' | 'error';
  message: string | null;
  savedFallbackFor: string | null;
};
const key = 'workout-journal.v1';

/** What cannot happen under a pause: logging, starting a set, moving on or retiming the rest. */
function running(workout: WorkoutRecord) {
  if (workout.pausedAt !== null) {
    throw new Error('This workout is paused. Resume it first.');
  }
  return workout;
}
function replaceWorkout(
  data: WorkoutJournal,
  id: string,
  update: (workout: WorkoutRecord) => WorkoutRecord,
): WorkoutJournal {
  if (!data.workouts.some((workout) => workout.id === id)) {
    throw new Error('This workout is unavailable.');
  }
  return {
    ...data,
    workouts: data.workouts.map((workout) =>
      workout.id === id ? update(workout) : workout,
    ),
  };
}
function replaceSet(
  workout: WorkoutRecord,
  exerciseId: string,
  setId: string,
  update: (set: WorkoutSet) => WorkoutSet,
): WorkoutRecord {
  if (workout.status !== 'active') {
    throw new Error('This workout is already finished.');
  }
  if (
    !workout.exercises.some(
      (exercise) =>
        exercise.id === exerciseId && exercise.sets.some((set) => set.id === setId),
    )
  ) {
    throw new Error('This set is unavailable.');
  }
  return {
    ...workout,
    exercises: workout.exercises.map((exercise) =>
      exercise.id !== exerciseId
        ? exercise
        : {
            ...exercise,
            sets: exercise.sets.map((set) => (set.id === setId ? update(set) : set)),
          },
    ),
  };
}

export class WorkoutJournalStore {
  private storage: ScopedStorage;
  private connection: AccountConnection;
  private uuid: () => string;
  private now: () => number;
  private current: JournalState;
  private listeners = new Set<() => void>();
  private writes: Promise<unknown> = Promise.resolve();
  private issued = 0;
  private generation = 0;
  private loading: Promise<void> | null = null;
  private syncing: Promise<void> | null = null;
  private onSynced: () => void;

  constructor(
    storage: ScopedStorage,
    connection: AccountConnection,
    uuid: () => string,
    now = Date.now,
    onSynced = () => {},
  ) {
    this.storage = storage;
    this.connection = connection;
    this.uuid = uuid;
    this.now = now;
    this.onSynced = onSynced;
    this.current = {
      data: emptyJournal(connection),
      ready: false,
      busy: false,
      syncing: false,
      saveStatus: 'saved',
      message: null,
      savedFallbackFor: null,
    };
  }
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<JournalState>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  cancel() {
    this.generation++;
    this.loading = null;
    this.syncing = null;
  }

  initialize = (): Promise<void> => {
    if (this.current.ready) {
      return Promise.resolve();
    }
    if (this.loading) {
      return this.loading;
    }
    const generation = this.generation;
    this.publish({ busy: true, message: null });
    this.loading = this.load(generation).finally(() => {
      if (generation === this.generation) {
        this.loading = null;
      }
    });
    return this.loading;
  };
  private async load(generation: number) {
    try {
      const data = readJournal(await this.storage.get(key), this.connection);
      if (generation === this.generation) {
        this.publish({ data, ready: true, busy: false, message: null });
        void this.sync();
      }
    } catch (failure) {
      if (generation === this.generation) {
        this.publish({
          ready: false,
          busy: false,
          message:
            failureNotice(
              'Could not open saved workouts. Retry loading; existing data has been preserved.',
              failure,
            ),
        });
      }
    }
  }
  private write(update?: (data: WorkoutJournal) => WorkoutJournal): Promise<void> {
    const generation = this.generation;
    const issued = ++this.issued;
    this.publish({ saveStatus: 'saving' });
    const result = this.writes.then(async () => {
      if (generation !== this.generation) {
        return;
      }
      const next = update ? update(this.current.data) : this.current.data;
      await this.storage.set(key, JSON.stringify(next));
      if (generation !== this.generation) {
        return;
      }
      this.publish({
        ...(update ? { data: update(this.current.data) } : {}),
        ...(issued === this.issued ? { saveStatus: 'saved' as const } : {}),
      });
    });
    this.writes = result.catch(() => undefined);
    return result.catch((error) => {
      if (generation === this.generation && issued === this.issued) {
        this.publish({ saveStatus: 'error' });
      }
      throw error;
    });
  }
  retrySave = async () => {
    if (!this.current.ready) {
      await this.initialize();
      return;
    }
    try {
      await this.write();
      this.publish({ message: null });
    } catch (failure) {
      this.publish({
        message: failureNotice(
          'Changes could not be saved on this phone. Keep the app open and retry.',
          failure,
        ),
      });
    }
  };

  /**
   * A fresh AI prescription is still to be made. The current app asks for it itself, because
   * `/api/workout-data`'s own background request to `/prescribe` silently never arrives in
   * production; when the model fails the server stores the program as written (RV-202), so the
   * re-read usually has numbers. If it still has none, start from the program as written, which is
   * what the current app shows once its polls run out, rather than refusing to start at all.
   */
  private async settlePending(
    pending: SessionPreview,
    programId: string,
    options: SessionStartOptions,
  ): Promise<SessionPreview> {
    try {
      await this.connection.post(
        `/api/ai-periodization/session/${pending.id}/prescribe`,
        {},
      );
      const again = readSessionResponse(
        await this.connection.get('/api/workout-data', {
          tab: pending.id,
          poll: '1',
          ...(options.aiDeload ? { aiDeload: '1' } : {}),
        }),
        this.connection,
        programId,
        pending.id,
      );
      if (!again.prescriptionPending) {
        return again;
      }
      pending = again;
    } catch (failure) {
      // A refused or failed generation falls through to the program as written.
      reportError(failure);
    }
    this.publish({ message: PROGRAM_AS_WRITTEN });
    return { ...pending, prescriptionPending: false };
  }

  start = async (
    session: SessionPreview,
    programId: string,
    useSaved = false,
    options: SessionStartOptions = {},
  ): Promise<string | null> => {
    if (!this.current.ready || this.current.busy) {
      return null;
    }
    const active = this.current.data.workouts.find(
      (workout) => workout.status === 'active',
    );
    if (active) {
      return active.id;
    }
    const generation = this.generation;
    this.publish({ busy: true, message: null, savedFallbackFor: null });
    try {
      let selected = session;
      if (!useSaved) {
        let response: unknown;
        try {
          response = await this.connection.get('/api/workout-data', {
            tab: session.id,
            ...(options.aiDeload ? { aiDeload: '1' } : {}),
          });
        } catch (error) {
          const fallback =
            !session.prescriptionPending &&
            (!(error instanceof ApiError) || error.status >= 500 || error.status === 429);
          if (generation === this.generation) {
            this.publish({
              savedFallbackFor: fallback ? session.id : null,
              message: fallback
                ? failureNotice(
                    'Could not fetch the current prescription. Retry, or explicitly start with the saved session.',
                    error,
                  )
                : 'Your account could not load this session. Check your sign-in and retry.',
            });
          }
          return null;
        }
        selected = readSessionResponse(response, this.connection, programId, session.id);
        if (selected.prescriptionPending) {
          selected = await this.settlePending(selected, programId, options);
        }
      }
      if (generation !== this.generation) {
        return null;
      }
      selected = prepareSession(selected, options);
      const workout = createWorkout(
        selected,
        programId,
        this.connection.timezone,
        useSaved,
        this.now(),
        this.uuid,
      );
      workout.timers = { ...this.current.data.preferences.timers };
      if (workout.timers.warmupSeconds !== null) {
        workout.warmupGoalSeconds = workout.timers.warmupSeconds;
        workout.warmupGoalSource = 'selected';
      }
      workout.exercises = workout.exercises.map((x) => ({
        ...x,
        weightUnit: this.current.data.preferences.units[x.id] ?? 'kg',
      }));
      workout.intensityMode = options.aiDeload ? 'deload' : 'full';
      workout.wasOverride =
        !!options.fullOverride || !!options.revertedExerciseIds?.length;
      await this.write((data) => ({ ...data, workouts: [...data.workouts, workout] }));
      if (generation !== this.generation) {
        return null;
      }
      return workout.id;
    } catch (error) {
      if (generation === this.generation) {
        this.publish({
          message:
            this.current.saveStatus === 'error'
              ? 'Could not save the new workout on this phone. Retry before starting.'
              : error instanceof Error
                ? error.message
                : 'Could not start this workout.',
        });
      }
      return null;
    } finally {
      if (generation === this.generation) {
        this.publish({ busy: false });
      }
    }
  };

  updateSet = (
    workoutId: string,
    exerciseId: string,
    setId: string,
    field: 'weight' | 'reps',
    value: string,
  ) =>
    this.edit((data) =>
      replaceWorkout(data, workoutId, (workout) =>
        replaceSet(workout, exerciseId, setId, (set) => ({
          ...set,
          [field]: value.slice(0, field === 'weight' ? 20 : 4),
        })),
      ),
    );

  private async edit(update: (data: WorkoutJournal) => WorkoutJournal): Promise<boolean> {
    if (!this.current.ready || this.current.busy) {
      return false;
    }
    const generation = this.generation;
    let data: WorkoutJournal;
    try {
      data = update(this.current.data);
    } catch (error) {
      this.publish({
        message: error instanceof Error ? error.message : 'Could not update this set.',
      });
      return false;
    }
    this.publish({ data, message: null });
    const saving = this.write();
    const issued = this.issued;
    try {
      await saving;
      return generation === this.generation;
    } catch (failure) {
      if (generation === this.generation && issued === this.issued) {
        this.publish({
          message:
            failureNotice(
              'Your latest entries could not be saved. Keep the app open and retry saving.',
              failure,
            ),
        });
      }
      return false;
    }
  }

  configureTimers = (
    workoutId: string,
    patch: Partial<TimerPreferences>,
    remember = false,
  ) =>
    this.action((data) => {
      const next = replaceWorkout(data, workoutId, (workout) => {
        if (workout.status !== 'active') {
          throw new Error('This workout is finished.');
        }
        const timers = timerPreferencesSchema.parse({ ...workout.timers, ...patch });
        return {
          ...workout,
          timers,
          ...(patch.warmupSeconds != null
            ? {
                warmupGoalSeconds: patch.warmupSeconds,
                warmupGoalSource: 'selected' as const,
              }
            : {}),
        };
      });
      return remember
        ? {
            ...next,
            preferences: {
              ...next.preferences,
              timers: timerPreferencesSchema.parse({
                ...next.preferences.timers,
                ...patch,
              }),
            },
          }
        : next;
    });

  setWeightUnit = (workoutId: string, exerciseId: string, unit: 'kg' | 'lb') =>
    this.edit((data) => {
      const exercise = data.workouts
        .find((x) => x.id === workoutId)
        ?.exercises.find((x) => x.id === exerciseId);
      if (!exercise) {
        throw new Error('This exercise is unavailable.');
      }
      return {
        ...replaceWorkout(data, workoutId, (workout) => ({
          ...workout,
          exercises: workout.exercises.map((x) =>
            x.id === exerciseId ? { ...x, weightUnit: unit } : x,
          ),
        })),
        preferences: {
          ...data.preferences,
          units: { ...data.preferences.units, [exercise.relogOf ?? exerciseId]: unit },
        },
      };
    });

  reusePrevious = (
    workoutId: string,
    exerciseId: string,
    expected: ReturnType<typeof previousValueChanges>,
  ) =>
    this.action((data) =>
      replaceWorkout(data, workoutId, (workout) =>
        reusePreviousValues(workout, exerciseId, expected),
      ),
    );

  adjustRest = (workoutId: string, seconds: number) =>
    this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        if (!workout.rest || workout.status !== 'active' || !Number.isInteger(seconds)) {
          throw new Error('There is no timed rest to adjust.');
        }
        running(workout);
        const endsAt = workout.rest.endsAt + seconds * 1000;
        if (
          endsAt < workout.rest.startedAt ||
          endsAt - workout.rest.startedAt > 86_400_000
        ) {
          throw new Error('Rest must be between 0 and 24 hours.');
        }
        return {
          ...workout,
          rest: { ...workout.rest, endsAt },
          restAdjustmentSeconds: workout.restAdjustmentSeconds + seconds,
        };
      }),
    );

  rateSet = (workoutId: string, exerciseId: string, setId: string, rpe: number) =>
    this.edit((data) =>
      replaceWorkout(data, workoutId, (workout) =>
        replaceSet(workout, exerciseId, setId, (set) => {
          if (!Number.isInteger(rpe) || rpe < 5 || rpe > 10) {
            throw new Error('Use an effort rating from 5 to 10.');
          }
          return { ...set, rpe, rpeSource: 'rated' };
        }),
      ),
    );

  resolveSuggestion = (
    workoutId: string,
    exerciseId: string,
    setId: string,
    accept: boolean,
  ) =>
    this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        const exercise = workout.exercises.find((exercise) => exercise.id === exerciseId);
        const set = exercise?.sets.find((set) => set.id === setId);
        if (!exercise || !set || set.completedAt !== null) {
          throw new Error('This set is unavailable.');
        }
        const suggestion = loadSuggestion(workout, exercise, set);
        return replaceSet(workout, exerciseId, setId, (set) => ({
          ...set,
          suggestionHandled: true,
          weight: accept && suggestion ? String(suggestion.weightKg) : set.weight,
        }));
      }),
    );

  private action = async (
    update: (data: WorkoutJournal) => WorkoutJournal,
  ): Promise<boolean> => {
    if (!this.current.ready || this.current.busy) {
      return false;
    }
    const generation = this.generation;
    this.publish({ busy: true, message: null });
    let writing = false;
    try {
      update(this.current.data);
      writing = true;
      await this.write(update);
      return generation === this.generation;
    } catch (error) {
      if (generation === this.generation) {
        this.publish({
          message:
            writing && this.current.saveStatus === 'error'
              ? 'Could not save this action on the phone. Your earlier progress is preserved; retry.'
              : error instanceof Error
                ? error.message
                : 'Could not save this action.',
        });
      }
      return false;
    } finally {
      if (generation === this.generation) {
        this.publish({ busy: false });
      }
    }
  };

  startSet = (workoutId: string, exerciseId: string, setId: string) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        if (workout.runningSet) {
          throw new Error('Record the running set first.');
        }
        const next = replaceSet(endRest(running(workout), now), exerciseId, setId, (set) => {
          if (set.completedAt !== null) {
            throw new Error('This set is already recorded.');
          }
          return { ...set, startedAt: now };
        });
        return {
          ...next,
          flow: { stage: 'exercise', exerciseId },
          runningSet: { exerciseId, setId },
        };
      }),
    );
  };
  recordSet = (workoutId: string, exerciseId: string, setId: string) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        if (
          workout.runningSet &&
          (workout.runningSet.exerciseId !== exerciseId ||
            workout.runningSet.setId !== setId)
        ) {
          throw new Error('Record the running set first.');
        }
        let restSeconds = 0;
        const next = replaceSet(
          endRest(running(workout), now, false),
          exerciseId,
          setId,
          (set) => {
            if (set.completedAt !== null) {
              throw new Error('This set is already recorded.');
            }
            setValues(set);
            restSeconds = set.planned?.restSeconds ?? 0;
            return {
              ...set,
              completedAt: Math.max(now, set.startedAt ?? workout.startedAt),
            };
          },
        );
        const partner = supersetNext(next, exerciseId, setId);
        const summary =
          !partner &&
          next.exercises
            .find((x) => x.id === exerciseId)!
            .sets.every((x) => x.completedAt !== null);
        // Every set's rest falls back to the current app's 90 s when its style sets none, then the
        // workout's rest adjustment applies.
        restSeconds = Math.max(
          0,
          effectiveRestSec(restSeconds) + workout.restAdjustmentSeconds,
        );
        return {
          ...next,
          flow: {
            stage: summary ? 'summary' : 'exercise',
            exerciseId: partner?.id ?? exerciseId,
          },
          runningSet: null,
          exercises: partner
            ? next.exercises.map((exercise) =>
                exercise.id === partner.id
                  ? { ...exercise, readyStartedAt: exercise.readyStartedAt ?? now }
                  : exercise,
              )
            : summary
              ? next.exercises.map((x) =>
                  x.id !== exerciseId
                    ? x
                    : {
                        ...x,
                        sets: x.sets.map((y) =>
                          y.id !== setId || y.startedAt === null
                            ? y
                            : { ...y, restAfterSec: 0 },
                        ),
                      },
                )
              : next.exercises,
          restAnchor: summary ? null : { exerciseId, setId, startedAt: now },
          // The last set still earns its rest, timed on the exercise summary until Next (#3111).
          rest: summary
            ? {
                exerciseId,
                setId,
                startedAt: now,
                endsAt: now + restSeconds * 1000,
                lastSet: true as const,
              }
            : restSeconds > 0
              ? { exerciseId, setId, startedAt: now, endsAt: now + restSeconds * 1000 }
              : null,
        };
      }),
    );
  };
  skipRest = (workoutId: string) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => endRest(running(workout), now)),
    );
  };
  /** Freezes every clock until `resume`; the pause is in the journal, so it survives a kill (#3266). */
  pause = (workoutId: string) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => pauseWorkout(workout, now)),
    );
  };
  resume = (workoutId: string) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => resumeWorkout(workout, now)),
    );
  };
  beginExercises = (workoutId: string) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        if (
          workout.status !== 'active' ||
          workout.runningSet ||
          workout.flow?.stage !== 'warmup'
        ) {
          throw new Error('This workout has already moved past its warm-up.');
        }
        return {
          ...workout,
          warmupEndedAt: workout.warmupEndedAt ?? Math.max(now, workout.startedAt),
          exercises: workout.exercises.map((exercise, index) =>
            index === 0
              ? { ...exercise, readyStartedAt: exercise.readyStartedAt ?? now }
              : exercise,
          ),
          flow: { stage: 'exercise', exerciseId: workout.exercises[0].id },
        };
      }),
    );
  };
  advanceExercise = (workoutId: string) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        if (workout.status !== 'active' || workout.runningSet) {
          throw new Error('Record the running set before moving on.');
        }
        running(workout);
        const flow = nextExerciseFlow(workout);
        const rested = endRest(running(workout), now);
        return {
          ...rested,
          flow,
          exercises: rested.exercises.map((exercise) =>
            exercise.id === flow.exerciseId
              ? { ...exercise, readyStartedAt: exercise.readyStartedAt ?? now }
              : exercise,
          ),
        };
      }),
    );
  };
  chooseExercise = (workoutId: string, exerciseId: string, solo = false) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        const exercise = workout.exercises.find((exercise) => exercise.id === exerciseId);
        if (workout.status !== 'active' || workout.runningSet || !exercise) {
          throw new Error('Record the running set before choosing another exercise.');
        }
        const rested = endRest(running(workout), now);
        return {
          ...rested,
          warmupEndedAt: workout.warmupEndedAt ?? now,
          soloExerciseId: solo ? exerciseId : null,
          exercises: rested.exercises.map((item) =>
            item.id === exerciseId
              ? { ...item, skipped: false, readyStartedAt: item.readyStartedAt ?? now }
              : item,
          ),
          flow: {
            stage: exercise.sets.every((set) => set.completedAt !== null)
              ? 'summary'
              : 'exercise',
            exerciseId,
          },
        };
      }),
    );
  };
  redoExercise = (workoutId: string, exerciseId: string) => {
    const now = this.now();
    const cloneId = this.uuid();
    const logId = this.uuid();
    const sourceSets =
      this.current.data.workouts
        .find((x) => x.id === workoutId)
        ?.exercises.find((x) => x.id === exerciseId)?.sets ?? [];
    const setIds = new Map(sourceSets.map((x) => [x.id, this.uuid()]));
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        const source = workout.exercises.find((exercise) => exercise.id === exerciseId);
        if (
          !source ||
          workout.status !== 'active' ||
          workout.runningSet ||
          source.sets.some((set) => set.completedAt === null)
        ) {
          throw new Error('Finish the running set before re-logging.');
        }
        const clone = {
          ...source,
          id: cloneId,
          logId,
          lastDate: workout.date,
          lastWeights: source.sets.map((x) => setValues(x).weight),
          lastReps: source.sets.map((x) => setValues(x).reps),
          relogOf: source.relogOf ?? source.id,
          supersetGroup: null,
          readyStartedAt: now,
          sets: source.sets.map((set) => ({
            ...set,
            id: setIds.get(set.id)!,
            startedAt: null,
            completedAt: null,
            restAfterSec: null,
            suggestionHandled: false,
            rpe: expectedRpe(
              source.exerciseType === 'bodyweight' ? undefined : set.planned?.percent,
              set.planned?.reps,
            ),
            rpeSource: 'expected' as const,
          })),
        };
        return {
          ...endRest(running(workout), now),
          exercises: [...endRest(running(workout), now).exercises, clone],
          soloExerciseId: clone.id,
          flow: { stage: 'exercise', exerciseId: clone.id },
        };
      }),
    );
  };
  swapExercise = (
    workoutId: string,
    exerciseId: string,
    alternative: Pick<
      SessionPreview['exercises'][number],
      | 'name'
      | 'muscles'
      | 'mainMuscles'
      | 'secondaryMuscles'
      | 'equipment'
      | 'instructions'
      | 'exerciseType'
      | 'estimated1rm'
      | 'lastReps'
      | 'lastDate'
      | 'lastWeights'
    >,
  ) => {
    const now = this.now();
    const archiveId = this.uuid();
    const replacementLogId = this.uuid();
    const sourceSets =
      this.current.data.workouts
        .find((x) => x.id === workoutId)
        ?.exercises.find((x) => x.id === exerciseId)?.sets ?? [];
    const setIds = new Map(sourceSets.map((x) => [x.id, this.uuid()]));
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        const source = workout.exercises.find((exercise) => exercise.id === exerciseId);
        if (!source || workout.status !== 'active' || workout.runningSet) {
          throw new Error('Finish the running set before swapping exercises.');
        }
        const recorded = source.sets.filter((set) => set.completedAt !== null);
        const remaining = source.sets.filter((set) => set.completedAt === null);
        if (!remaining.length) {
          throw new Error('This exercise is already complete.');
        }
        const archive = recorded.length
          ? {
              ...source,
              id: archiveId,
              relogOf: source.relogOf ?? source.id,
              retired: true,
              sets: recorded,
            }
          : null;
        const basis = { ...source, ...alternative, target80: null, latestWeight: null };
        const replacement = {
          ...source,
          ...alternative,
          logId: archive ? replacementLogId : source.logId,
          mainMuscles: alternative.mainMuscles ?? alternative.muscles,
          secondaryMuscles: alternative.secondaryMuscles ?? [],
          lastReps: alternative.lastReps ?? [],
          lastDate: alternative.lastDate ?? null,
          latestWeight: null,
          target80: null,
          readyStartedAt: now,
          sets: remaining.map((set) => ({
            ...set,
            id: setIds.get(set.id)!,
            weight: String(initialWeight(basis, set.planned)),
            startedAt: null,
            plannedWeight: prescribedWeight(basis, set.planned),
            suggestionHandled: false,
          })),
        };
        const rested = endRest(running(workout), now);
        return {
          ...rested,
          exercises: [
            ...rested.exercises.map((exercise) =>
              exercise.id === exerciseId ? replacement : exercise,
            ),
            ...(archive ? [archive] : []),
          ],
          flow: { stage: 'exercise', exerciseId },
        };
      }),
    );
  };
  showSession = (workoutId: string) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        if (workout.status !== 'active') {
          throw new Error('This workout is already finished.');
        }
        const flow = workoutFlow(workout);
        return {
          ...endRest(running(workout), now),
          soloExerciseId: null,
          hubReturnStage: flow.stage === 'review' ? workout.hubReturnStage : flow.stage,
          flow: { stage: 'review', exerciseId: flow.exerciseId },
        };
      }),
    );
  };
  continueSession = (workoutId: string) =>
    this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        if (workout.status !== 'active') {
          throw new Error('This workout is already finished.');
        }
        const exercise =
          workout.exercises.find(
            (exercise) => exercise.id === workout.runningSet?.exerciseId,
          ) ??
          workout.exercises.find(
            (exercise) =>
              !exercise.retired &&
              !exercise.relogOf &&
              !exercise.skipped &&
              exercise.sets.some((set) => set.completedAt === null),
          );
        if (!exercise) {
          throw new Error('All exercises are complete. Finish the workout.');
        }
        const stage = workout.hubReturnStage === 'warmup' ? 'warmup' : 'exercise';
        return {
          ...workout,
          soloExerciseId: null,
          hubReturnStage: null,
          flow: { stage, exerciseId: exercise.id },
        };
      }),
    );
  skipExercise = (workoutId: string) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        if (workout.status !== 'active') {
          throw new Error('This workout is already finished.');
        }
        const flow = workoutFlow(workout);
        const next = nextExerciseFlow(workout);
        const rested = endRest(running(workout), now);
        return {
          ...rested,
          runningSet: null,
          soloExerciseId: null,
          flow: workout.soloExerciseId
            ? { stage: 'review', exerciseId: flow.exerciseId }
            : next,
          exercises: rested.exercises.map((exercise) => ({
            ...exercise,
            skipped: exercise.id === flow.exerciseId ? true : exercise.skipped,
            readyStartedAt:
              exercise.id === next.exerciseId
                ? (exercise.readyStartedAt ?? now)
                : exercise.readyStartedAt,
            sets: exercise.sets.map((set) =>
              set.id === workout.runningSet?.setId ? { ...set, startedAt: null } : set,
            ),
          })),
        };
      }),
    );
  };
  finish = async (workoutId: string) => {
    const now = this.now();
    const saved = await this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => finishWorkout(workout, now)),
    );
    if (saved) {
      void this.sync();
    }
    return saved;
  };
  discard = (workoutId: string) =>
    this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => {
        if (workout.status !== 'active') {
          throw new Error('This workout is already finished.');
        }
        return {
          ...workout,
          status: 'discarded',
          runningSet: null,
          rest: null,
          restAnchor: null,
        };
      }),
    );
  removeCompleted = (workoutId: string) =>
    this.action((data) => {
      const workout = data.workouts.find((workout) => workout.id === workoutId);
      if (workout && (workout.status !== 'completed' || workout.pending.length)) {
        throw new Error('Upload this workout before deleting its history.');
      }
      return {
        ...data,
        workouts: data.workouts.filter((workout) => workout.id !== workoutId),
      };
    });

  sync = (): Promise<void> => {
    if (!this.current.ready || this.current.busy) {
      return Promise.resolve();
    }
    if (this.syncing) {
      return this.syncing;
    }
    const generation = this.generation;
    this.publish({ syncing: true });
    this.syncing = this.flush(generation).finally(() => {
      if (generation === this.generation) {
        this.syncing = null;
        this.publish({ syncing: false });
      }
    });
    return this.syncing;
  };
  private async flush(generation: number) {
    try {
      await this.write();
      while (generation === this.generation && !this.current.busy) {
        const workout = this.current.data.workouts.find(
          (workout) => workout.status === 'completed' && workout.pending.length > 0,
        );
        if (!workout) {
          return;
        }
        const pending = workout.pending[0];
        try {
          await pushMutation(this.connection, mutationFor(workout, pending));
          if (generation !== this.generation) {
            return;
          }
          const now = this.now();
          await this.write((data) =>
            replaceWorkout(data, workout.id, (latest) => {
              const remaining = latest.pending.filter((item) => item.id !== pending.id);
              return {
                ...latest,
                pending: remaining,
                syncedAt: remaining.length === 0 ? now : null,
                syncError: null,
              };
            }),
          );
          if (pending.domain === 'complete_workout' && generation === this.generation) {
            this.onSynced();
          }
        } catch (error) {
          if (generation !== this.generation) {
            return;
          }
          const message =
            error instanceof ApiError && [401, 403].includes(error.status)
              ? 'Sign in again to upload this workout. It is saved on this phone.'
              : failureNotice(
                  'Workout saved on this phone. Upload is pending; retry when connected.',
                  error,
                );
          await this.write((data) =>
            replaceWorkout(data, workout.id, (latest) => ({
              ...latest,
              syncError: message,
            })),
          );
          return;
        }
      }
    } catch (failure) {
      if (generation === this.generation) {
        this.publish({
          message:
            failureNotice(
              'Could not save the upload status locally. Your workout has been kept; retry saving.',
              failure,
            ),
        });
      }
    }
  }
}
