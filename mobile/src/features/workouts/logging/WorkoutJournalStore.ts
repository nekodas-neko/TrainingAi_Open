import type { ScopedStorage } from '../../../core/storage/LocalStorage.ts';
import { pushMutation } from '../../../core/sync/pushMutation.ts';
import { ApiError } from '../../account/api/client.ts';
import type { AccountConnection } from '../../account/session.ts';
import { readSessionResponse, type SessionPreview } from '../catalog.ts';
import { nextExerciseFlow, supersetNext, workoutFlow } from './flow.ts';
import { expectedRpe, initialWeight, loadSuggestion, prescribedWeight } from './targets.ts';
import { prepareSession, type SessionStartOptions } from './session-options.ts';
import {
  createWorkout,
  emptyJournal,
  endRest,
  finishWorkout,
  mutationFor,
  readJournal,
  setValues,
  type WorkoutJournal,
  type WorkoutRecord,
  type WorkoutSet,
} from './workout.ts';

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
    workouts: data.workouts.map((workout) => (workout.id === id ? update(workout) : workout)),
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
      (exercise) => exercise.id === exerciseId && exercise.sets.some((set) => set.id === setId),
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
  private waitingSession: { id: string; requestedAt: number } | null = null;
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
    } catch {
      if (generation === this.generation) {
        this.publish({
          ready: false,
          busy: false,
          message:
            'Could not open saved workouts. Retry loading; existing data has been preserved.',
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
    } catch {
      this.publish({
        message: 'Changes could not be saved on this phone. Keep the app open and retry.',
      });
    }
  };

  start = async (
    session: SessionPreview,
    programId: string,
    useSaved = false,
    options: SessionStartOptions = {},
  ): Promise<string | null> => {
    if (!this.current.ready || this.current.busy) {
      return null;
    }
    const active = this.current.data.workouts.find((workout) => workout.status === 'active');
    if (active) {
      return active.id;
    }
    const generation = this.generation;
    this.publish({ busy: true, message: null, savedFallbackFor: null });
    try {
      let selected = session;
      if (!useSaved) {
        const polling =
          this.waitingSession?.id === session.id &&
          this.now() - this.waitingSession.requestedAt < 60_000;
        let response: unknown;
        try {
          response = await this.connection.get('/api/workout-data', {
            tab: session.id,
            ...(options.aiDeload ? { aiDeload: '1' } : {}),
            ...(polling ? { poll: '1' } : {}),
          });
        } catch (error) {
          const fallback =
            !session.prescriptionPending &&
            (!(error instanceof ApiError) || error.status >= 500 || error.status === 429);
          if (generation === this.generation) {
            this.publish({
              savedFallbackFor: fallback ? session.id : null,
              message: fallback
                ? 'Could not fetch the current prescription. Retry, or explicitly start with the saved session.'
                : 'Your account could not load this session. Check your sign-in and retry.',
            });
          }
          return null;
        }
        selected = readSessionResponse(response, this.connection, programId, session.id);
        if (selected.prescriptionPending) {
          if (!polling) {
            this.waitingSession = { id: session.id, requestedAt: this.now() };
          }
          throw new Error(
            'The backend is preparing this session’s prescription. Check again shortly.',
          );
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
      workout.intensityMode = options.aiDeload ? 'deload' : 'full';
      workout.wasOverride = !!options.fullOverride || !!options.revertedExerciseIds?.length;
      await this.write((data) => ({ ...data, workouts: [...data.workouts, workout] }));
      if (generation !== this.generation) {
        return null;
      }
      this.waitingSession = null;
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
  ) => {
    if (!this.current.ready || this.current.busy) {
      return;
    }
    const data = replaceWorkout(this.current.data, workoutId, (workout) =>
      replaceSet(workout, exerciseId, setId, (set) => ({
        ...set,
        [field]: value.slice(0, field === 'weight' ? 20 : 4),
      })),
    );
    this.publish({ data, message: null });
    const saving = this.write();
    const issued = this.issued;
    void saving.catch(() => {
      if (issued !== this.issued) {
        return;
      }
      this.publish({
        message: 'Your latest entries could not be saved. Keep the app open and retry saving.',
      });
    });
  };

  rateSet = (workoutId: string, exerciseId: string, setId: string, rpe: number) =>
    this.action((data) =>
      replaceWorkout(data, workoutId, (workout) =>
        replaceSet(workout, exerciseId, setId, (set) => {
          if (!Number.isInteger(rpe) || rpe < 5 || rpe > 10) {
            throw new Error('Use an effort rating from 5 to 10.');
          }
          return { ...set, rpe, rpeSource: 'rated' };
        }),
      ),
    );

  resolveSuggestion = (workoutId: string, exerciseId: string, setId: string, accept: boolean) =>
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
        const next = replaceSet(endRest(workout, now), exerciseId, setId, (set) => {
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
          (workout.runningSet.exerciseId !== exerciseId || workout.runningSet.setId !== setId)
        ) {
          throw new Error('Record the running set first.');
        }
        let restSeconds = 0;
        const next = replaceSet(endRest(workout, now, false), exerciseId, setId, (set) => {
          if (set.completedAt !== null) {
            throw new Error('This set is already recorded.');
          }
          setValues(set);
          restSeconds = set.planned?.restSeconds ?? 0;
          return { ...set, completedAt: Math.max(now, set.startedAt ?? workout.startedAt) };
        });
        const partner = supersetNext(next, exerciseId, setId);
        return {
          ...next,
          flow: {
            stage:
              !partner &&
              next.exercises
                .find((exercise) => exercise.id === exerciseId)!
                .sets.every((set) => set.completedAt !== null)
                ? 'summary'
                : 'exercise',
            exerciseId: partner?.id ?? exerciseId,
          },
          runningSet: null,
          exercises: partner
            ? next.exercises.map((exercise) =>
                exercise.id === partner.id
                  ? { ...exercise, readyStartedAt: exercise.readyStartedAt ?? now }
                  : exercise,
              )
            : next.exercises,
          rest:
            restSeconds > 0
              ? { exerciseId, setId, startedAt: now, endsAt: now + restSeconds * 1000 }
              : null,
        };
      }),
    );
  };
  skipRest = (workoutId: string) => {
    const now = this.now();
    return this.action((data) =>
      replaceWorkout(data, workoutId, (workout) => endRest(workout, now)),
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
        const flow = nextExerciseFlow(workout);
        const rested = endRest(workout, now);
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
        const rested = endRest(workout, now);
        return {
          ...rested,
          warmupEndedAt: workout.warmupEndedAt ?? now,
          soloExerciseId: solo ? exerciseId : null,
          exercises: rested.exercises.map((item) =>
            item.id === exerciseId
              ? { ...item, readyStartedAt: item.readyStartedAt ?? now }
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
          id: this.uuid(),
          logId: this.uuid(),
          relogOf: source.relogOf ?? source.id,
          supersetGroup: null,
          readyStartedAt: now,
          sets: source.sets.map((set) => ({
            ...set,
            id: this.uuid(),
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
          ...endRest(workout, now),
          exercises: [...endRest(workout, now).exercises, clone],
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
              id: this.uuid(),
              relogOf: source.relogOf ?? source.id,
              retired: true,
              sets: recorded,
            }
          : null;
        const basis = { ...source, ...alternative, target80: null, latestWeight: null };
        const replacement = {
          ...source,
          ...alternative,
          logId: archive ? this.uuid() : source.logId,
          mainMuscles: alternative.mainMuscles ?? alternative.muscles,
          secondaryMuscles: alternative.secondaryMuscles ?? [],
          lastReps: alternative.lastReps ?? [],
          lastDate: alternative.lastDate ?? null,
          latestWeight: null,
          target80: null,
          readyStartedAt: now,
          sets: remaining.map((set) => ({
            ...set,
            id: this.uuid(),
            weight: String(initialWeight(basis, set.planned)),
            startedAt: null,
            plannedWeight: prescribedWeight(basis, set.planned),
            suggestionHandled: false,
          })),
        };
        const rested = endRest(workout, now);
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
          ...endRest(workout, now),
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
          workout.exercises.find((exercise) =>
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
        const rested = endRest(workout, now);
        return {
          ...rested,
          runningSet: null,
          soloExerciseId: null,
          flow: workout.soloExerciseId
            ? { stage: 'review', exerciseId: flow.exerciseId }
            : next,
          exercises: rested.exercises.map((exercise) => ({
            ...exercise,
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
        return { ...workout, status: 'discarded', runningSet: null, rest: null };
      }),
    );
  removeCompleted = (workoutId: string) =>
    this.action((data) => {
      const workout = data.workouts.find((workout) => workout.id === workoutId);
      if (workout && (workout.status !== 'completed' || workout.pending.length)) {
        throw new Error('Upload this workout before deleting its history.');
      }
      return { ...data, workouts: data.workouts.filter((workout) => workout.id !== workoutId) };
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
              : 'Workout saved on this phone. Upload is pending; retry when connected.';
          await this.write((data) =>
            replaceWorkout(data, workout.id, (latest) => ({ ...latest, syncError: message })),
          );
          return;
        }
      }
    } catch {
      if (generation === this.generation) {
        this.publish({
          message:
            'Could not save the upload status locally. Your workout has been kept; retry saving.',
        });
      }
    }
  }
}
