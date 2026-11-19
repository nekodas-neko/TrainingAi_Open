import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { workoutFlow } from '../src/features/workouts/logging/flow.ts';
import { workoutBack } from '../src/features/workouts/logging/back.ts';
import { localRecap } from '../src/features/workouts/logging/local-recap.ts';
import {
  lastActivityAt,
  STALE_WORKOUT_MS,
  workoutClockAt,
  type WorkoutRecord,
} from '../src/features/workouts/logging/workout.ts';
import {
  dayHistory,
  localOnlyWorkouts,
  UPLOAD_GRACE_MS,
} from '../src/features/workouts/data/workout-view.ts';
import type { HistoryOperation } from '../src/features/workouts/data/HistoryOutbox.ts';
import type { DayExercise } from '../src/features/workouts/data/models.ts';
import { calendarMarks } from '../src/features/health/data/training-view.ts';
import { sessionTrainingStatus } from '../src/features/workouts/catalog.ts';
import { pipCommand } from '../src/features/workouts/pip/pip.ts';
import { deadLettered } from '../src/core/sync/set-aside.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';

const TZ = 'Australia/Brisbane';

// A one-exercise session, so its summary is the last exercise's: "Continue" there finishes.
async function setup(t: { after(fn: () => void): void }, post?: () => Promise<unknown>) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  const sent: unknown[] = [];
  const connection = {
    ...f.connection,
    post: async (path: string, body: unknown) => {
      sent.push(body);
      return post ? post() : f.connection.post(path, body);
    },
  };
  let now = Date.UTC(2026, 9, 20, 0);
  const controller = new WorkoutJournalStore(
    storage.account(connection.origin, connection.userId),
    connection,
    f.uuid,
    () => now,
  );
  await controller.initialize();
  await controller.sync();
  const workout = () => controller.getSnapshot().data.workouts[0];
  async function toSummary() {
    const id = (await controller.start(f.session, programId, true))!;
    await controller.beginExercises(id);
    for (const set of workout().exercises[0].sets) {
      await controller.startSet(id, exerciseId, set.id);
      now += 30_000;
      await controller.recordSet(id, exerciseId, set.id);
      now += 60_000;
    }
    return id;
  }
  return { ...f, controller, workout, toSummary, sent, clock: (ms: number) => (now += ms), now: () => now };
}

const offline = async () => {
  throw new Error('Network request failed');
};

// --- #3879: Back on each workout stage ---

test('#3879: Back on each stage; the gesture never continues past a summary', () => {
  assert.equal(workoutBack('warmup', false, 'system'), 'session');
  assert.equal(workoutBack('exercise', true, 'system'), 'session');
  assert.equal(workoutBack('exercise', false, 'system'), 'leave');
  assert.equal(workoutBack('review', false, 'system'), 'leave');
  assert.equal(workoutBack('summary', false, 'system'), 'session');
  // The on-screen button on the summary is still "Continue", as in the current app.
  assert.equal(workoutBack('summary', false, 'header'), 'next');
  for (const stage of ['warmup', 'exercise', 'summary', 'review'] as const) {
    for (const ready of [true, false]) {
      assert.notEqual(workoutBack(stage, ready, 'system'), 'next', `${stage} ${ready}`);
    }
  }
});

test('#3879: Back on the last exercise summary leaves the workout open on the session hub', async (t) => {
  const f = await setup(t);
  const id = await f.toSummary();
  assert.equal(workoutFlow(f.workout()).stage, 'summary');
  assert.equal(workoutBack(workoutFlow(f.workout()).stage, false, 'system'), 'session');
  await f.controller.showSession(id);
  assert.equal(f.workout().status, 'active');
  assert.equal(workoutFlow(f.workout()).stage, 'review');
  assert.equal(f.workout().completedAt, null);
  assert.equal(f.sent.length, 0, 'nothing uploaded');
});

test('#3879: the guided screen sends the Android gesture through the system Back', async () => {
  const screen = await readFile(
    new URL('../src/features/workouts/screens/GuidedWorkoutScreen.tsx', import.meta.url),
    'utf8',
  );
  const layout = await readFile(
    new URL('../src/features/workouts/components/WorkoutLayout.tsx', import.meta.url),
    'utf8',
  );
  assert.match(screen, /onBack=\{\(\) => goBack\('header'\)\}/);
  assert.match(screen, /onSystemBack=\{\(\) => goBack\('system'\)\}/);
  // PageLayout's onBack is what useAndroidBack registers.
  assert.match(layout, /onBack=\{onSystemBack \?\? onBack\}/);
  assert.match(layout, /onPress=\{onBack\}/);
});

// --- #3880 items 1 to 3: one view for history and the done marks ---

async function finishedOffline(t: { after(fn: () => void): void }) {
  const f = await setup(t, offline);
  const id = await f.toSummary();
  await f.controller.finish(id);
  const workout = f.workout();
  assert.equal(workout.status, 'completed');
  assert.ok(workout.pending.length > 0);
  return { f, workout };
}
const op = (domain: HistoryOperation['domain'], payload: Record<string, unknown>) =>
  ({ id: crypto.randomUUID(), domain, date: '2026-10-20', payload }) as HistoryOperation;

test('#3880: a workout finished offline shows on its day, once, and nowhere else', async (t) => {
  const { workout } = await finishedOffline(t);
  const now = workout.completedAt! + 60_000;
  const local = dayHistory(workout.date, [], [workout], [], now);
  assert.equal(local.length, 1);
  assert.equal(local[0].workoutSessionId, workout.id);
  assert.equal(local[0].exerciseLogId, workout.exercises[0].logId);
  assert.equal(local[0].sets, workout.exercises[0].sets.length);
  assert.equal(dayHistory('2026-10-19', [], [workout], [], now).length, 0);
  // Once the server lists it, the server's row is the one shown.
  const server = { ...local[0], weightKg: 99 } as DayExercise;
  const merged = dayHistory(workout.date.replace(/-/g, '/'), [server], [workout], [], now);
  assert.deepEqual(merged, [server]);
  // The calendar marks the day from the phone.
  const marks = calendarMarks({
    month: workout.date.slice(0, 7),
    trainedDays: {},
    activityDays: {},
    activities: [],
    workouts: localOnlyWorkouts([workout], [], now),
    sessionColor: () => 'session',
    activityColor: 'activity',
  });
  assert.deepEqual(marks.markers[workout.date], [workout.sessionName]);
});

test('#3880: an uploaded workout counts from the server alone, after a short grace', async (t) => {
  const { workout } = await finishedOffline(t);
  const uploaded: WorkoutRecord = { ...workout, pending: [], syncedAt: workout.completedAt! };
  assert.equal(localOnlyWorkouts([uploaded], [], uploaded.syncedAt! + 1000).length, 1);
  const later = uploaded.syncedAt! + UPLOAD_GRACE_MS + 1;
  // Deleted on the web (or exercise by exercise): the server no longer lists it, so it is not done.
  assert.equal(localOnlyWorkouts([uploaded], [], later).length, 0);
  assert.equal(dayHistory(uploaded.date, [], [uploaded], [], later).length, 0);
  const status = sessionTrainingStatus(
    { trainedDate: null, lastTrained: null } as never,
    localOnlyWorkouts([uploaded], [], later).map((w) => w.date),
    TZ,
    new Date(later),
  );
  assert.equal(status.completed, false);
  assert.equal(status.lastTrained, 'Never trained');
  // Active and discarded workouts never count.
  assert.equal(localOnlyWorkouts([{ ...workout, status: 'discarded' }], [], later).length, 0);
});

test('#3880: a queued delete stops a phone-only workout counting at once', async (t) => {
  const { workout } = await finishedOffline(t);
  const now = workout.completedAt! + 1000;
  const session = op('workout_session_delete', { workoutSessionId: workout.id });
  assert.equal(localOnlyWorkouts([workout], [session], now).length, 0);
  const logs = workout.exercises
    .filter((x) => x.sets.some((s) => s.completedAt !== null))
    .map((x) => op('exercise_log_delete', { exerciseLogId: x.logId }));
  assert.equal(localOnlyWorkouts([workout], logs, now).length, 0);
  assert.equal(dayHistory(workout.date, [], [workout], logs, now).length, 0);
});

test('#3880: a pending edit shows its own top weight and set count beside its volume', () => {
  const entry: DayExercise = {
    name: 'Bench',
    sessionName: 'Push',
    exerciseType: 'weighted',
    weightKg: 60,
    setWeights: [60, 60, 60],
    sets: 3,
    reps: [8, 8, 8],
    timeToCompleteSet: null,
    loggedAt: null,
    exerciseLogId: '30000000-0000-4000-8000-000000000001',
    workoutSessionId: '30000000-0000-4000-8000-000000000002',
  };
  const edit = op('exercise_log_edit', {
    exerciseLogId: entry.exerciseLogId,
    weights: [70, 65],
    reps: [5, 5],
  });
  const [edited] = dayHistory('2026-10-20', [entry], [], [edit], Date.now());
  assert.deepEqual(
    { weightKg: edited.weightKg, sets: edited.sets, setWeights: edited.setWeights, reps: edited.reps },
    { weightKg: 70, sets: 2, setWeights: [70, 65], reps: [5, 5] },
  );
});

// --- #3880 item 4: Retry upload and the cards while it is pending ---

test('#3880: Retry upload re-sends a workout whose writes were set aside', async (t) => {
  let refuse = true;
  const f = await setup(t, async () => {
    if (!refuse) return { processed: 1, errors: [] };
    const change = (f.sent.at(-1) as { mutations: { id: string; domain: string; date: string }[] })
      .mutations[0];
    return { processed: 0, errors: [{ ...change, error: 'Bad payload', retryable: false }] };
  });
  const id = await f.toSummary();
  await f.controller.finish(id);
  for (let i = 0; i < 20 && !f.workout().pending.every(deadLettered); i++) {
    await f.controller.sync();
  }
  assert.ok(f.workout().pending.every(deadLettered), 'every write set aside');
  const before = f.sent.length;
  await f.controller.sync();
  assert.equal(f.sent.length, before, 'a plain sync passes them over');
  refuse = false;
  await f.controller.retryWorkout(id);
  assert.equal(f.workout().pending.length, 0);
  assert.ok(f.workout().syncedAt !== null);
});

test('#3880: the recap opens from the phone copy while the upload is pending', async (t) => {
  const { workout } = await finishedOffline(t);
  const recap = localRecap(workout, [workout]);
  assert.ok(recap && recap.length > 0);
  assert.match(recap, /kg/);
  assert.equal(localRecap({ ...workout, status: 'active', completedAt: null }, []), null);
});

// --- #3880 items 5 and 6 ---

test('#3880: a workout left overnight stops its Total at the last activity', async (t) => {
  const f = await setup(t);
  await f.toSummary();
  const workout = f.workout();
  const last = lastActivityAt(workout);
  assert.equal(workoutClockAt(workout, last + 60_000), last + 60_000);
  assert.equal(workoutClockAt(workout, last + STALE_WORKOUT_MS + 1), last);
  assert.equal(workoutClockAt(workout, last + 10 * 3_600_000), last);
});

test('#3880: picture-in-picture Next on a re-logged exercise summary returns to the session', async (t) => {
  const f = await setup(t);
  await f.toSummary();
  const summary = f.workout();
  assert.deepEqual(pipCommand(summary, 'log'), { type: 'advance' });
  assert.deepEqual(pipCommand({ ...summary, soloExerciseId: exerciseId }, 'log'), {
    type: 'session',
  });
});
