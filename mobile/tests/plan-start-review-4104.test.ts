// #4104 review. The card never says something the numbers under it do not show: a deload that cannot
// be put back to full says what will be trained, a deload that has not loaded is not drawn, the
// started workout records what was trained, an arrow compares like with like, and a plan that is
// only pending does not explain numbers it is not driving.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lastComparableLoads,
  planStartModel,
  type PlanPrescription,
  type PlanStartInput,
} from '../src/features/workouts/data/plan-start.ts';
import { deloadChoice, DELOAD_FAILED } from '../src/features/workouts/data/deload-choice.ts';
import {
  recordedIntensity,
  type SessionStartOptions,
} from '../src/features/workouts/logging/session-options.ts';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId } from './logging-fixture.ts';
import type { ExercisePreview } from '../src/features/workouts/catalog.ts';

const lift = (id: string, over: Partial<ExercisePreview> = {}): ExercisePreview => ({
  id,
  name: `Lift ${id}`,
  muscles: ['chest'],
  sets: [1, 2, 3].map((number) => ({ number, reps: 8, percent: 82.5, restSeconds: 120 })),
  setCount: 3,
  style: null,
  instructions: null,
  exerciseType: 'weighted',
  deloaded: false,
  lastWeights: [],
  equipment: [],
  estimated1rm: 100,
  target80: null,
  latestWeight: null,
  lastSetMode: null,
  ...over,
});
const style = [{ number: 1, reps: 8, percent: 82.5, restSeconds: 120 }];
const prescribedDeload = (over: Partial<PlanPrescription> = {}): PlanPrescription => ({
  phase: 'deload',
  phaseAction: 'deload_recommended',
  reasoning: 'Three hard weeks in a row.',
  deload: true,
  estimatedSessionDurationMin: 40,
  fullSession: { estimatedSessionDurationMin: 62 },
  exercises: [],
  ...over,
});
function input(over: Partial<PlanStartInput> = {}): PlanStartInput {
  const exercises = [lift('a'), lift('b'), lift('c'), lift('d')];
  return {
    aiDynamic: true,
    sessionId: 's1',
    sessionName: 'Push',
    isBaseline: false,
    exercises,
    asSent: exercises,
    durationMinutes: 60,
    phaseDetail: 'Accumulation · Session 2',
    preparing: false,
    prescription: {
      phase: 'accumulation',
      phaseAction: 'stay',
      reasoning: 'Your lifts moved well last week.',
      deload: false,
      estimatedSessionDurationMin: 62,
      exercises: [],
    },
    prescriptionStatus: 'auto_applied',
    deloadChosen: false,
    active: null,
    units: {},
    ...over,
  };
}

// 1. Full over a deload whose rows cannot be restored.
test('all lifts stay deloaded: the card describes the deload, Full is not offered, and it says why', () => {
  const rows = [lift('a', { deloaded: true }), lift('b', { deloaded: true })];
  for (const deloadChosen of [false, true]) {
    const model = planStartModel(
      input({ exercises: rows, asSent: rows, prescription: prescribedDeload(), deloadChosen }),
    )!;
    assert.equal(model.header, "Today's plan · Deload · prescribed");
    assert.equal(model.start.label, 'Start deload');
    assert.equal(model.link, null);
    assert.ok(model.notes.includes('Full numbers are not available for this plan yet'));
    assert.equal(model.meta, '2 exercises · about 40 min');
    assert.equal(model.reason, 'Three hard weeks in a row.');
    assert.doesNotMatch(model.reason ?? '', /skipped today|full numbers/i);
  }
});

test('some lifts stay deloaded: the card names them next to the rows and gives the minutes as a span', () => {
  const rows = [
    lift('a'),
    lift('b', { deloaded: true }),
    lift('c', { deloaded: true }),
    lift('d'),
  ];
  const model = planStartModel(
    input({ exercises: rows, asSent: rows, prescription: prescribedDeload(), deloadChosen: false }),
  )!;
  assert.equal(model.header, "Today's plan · Full · your choice");
  assert.ok(model.notes.includes('2 lifts stay light: Lift b, Lift c'));
  assert.equal(model.meta, '4 exercises · about 40–62 min');
  assert.doesNotMatch(model.reason ?? '', /skipped today: this runs your full numbers/);
  assert.equal(model.link?.kind, 'deload');
  const one = planStartModel(
    input({
      exercises: [lift('a'), lift('b', { deloaded: true })],
      asSent: [lift('a'), lift('b', { deloaded: true })],
      prescription: prescribedDeload(),
    }),
  )!;
  assert.ok(one.notes.includes('1 lift stays light: Lift b'));
});

test('lifts that can be restored keep Full offered and say nothing false', () => {
  const rows = [lift('a', { deloaded: true, preDeloadStyle: style }), lift('b', { deloaded: true, preDeloadStyle: style })];
  const model = planStartModel(
    input({ exercises: rows, asSent: rows, prescription: prescribedDeload(), deloadChosen: true }),
  )!;
  assert.deepEqual(model.link, { kind: 'full', label: 'Train full instead', busy: false });
  assert.deepEqual(model.notes, []);
});

test('Train full instead never calls the model: the tap handler has no regenerate in it', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const screen = read('../src/features/workouts/screens/SessionScreen.tsx');
  assert.ok(!screen.includes('regenerate'));
  assert.ok(!read('../src/features/workouts/components/PrescriptionControls.tsx').includes('regenerate'));
});

test('a workout whose every row stayed deloaded is recorded as a deload, and not as an override', () => {
  const light = [{ deloaded: true }, { deloaded: true }];
  assert.deepEqual(recordedIntensity({ aiDeload: false, fullOverride: true }, light), {
    intensityMode: 'deload',
    wasOverride: false,
  });
  // Some rows put back to full: a full session, overridden.
  assert.deepEqual(recordedIntensity({ aiDeload: false, fullOverride: true }, [{ deloaded: true }, { deloaded: false }]), {
    intensityMode: 'full',
    wasOverride: true,
  });
  assert.deepEqual(recordedIntensity({ aiDeload: true }, [{ deloaded: false }]), {
    intensityMode: 'deload',
    wasOverride: false,
  });
  assert.deepEqual(recordedIntensity({}, [{ deloaded: false }]), { intensityMode: 'full', wasOverride: false });
});

test('starting over rows that all stayed deloaded writes intensityMode deload to the journal', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  const controller = new WorkoutJournalStore(
    storage.account(f.connection.origin, f.connection.userId),
    f.connection,
    f.uuid,
    () => Date.UTC(2026, 10, 20, 2),
  );
  await controller.initialize();
  const session = { ...f.session, exercises: f.session.exercises.map((x) => ({ ...x, deloaded: true })) };
  const options: SessionStartOptions = { aiDeload: false, fullOverride: true };
  const id = await controller.start(session, programId, true, options);
  assert.ok(id);
  const workout = controller.getSnapshot().data.workouts[0]!;
  assert.equal(workout.intensityMode, 'deload');
  assert.equal(workout.wasOverride, false);
});

// 2. A deload is drawn only once its rows are loaded.
test('a deload that has not loaded is not the deload: first tap, offline, server error', () => {
  const base = { requested: true, prescribedDeload: false, fullRows: [{ deloaded: false }] };
  const rowsLoaded = [{ deloaded: true }, { deloaded: true }];
  const read = { connected: true, loading: false, refreshing: false, error: null };
  // First tap: asked, nothing here yet, the read is under way.
  assert.deepEqual(
    deloadChoice({ ...base, deloadRows: undefined, read: { ...read, loading: true } }),
    { ready: false, status: 'loading' },
  );
  // Offline (no connection) and a server error: back to the full plan.
  assert.deepEqual(
    deloadChoice({ ...base, deloadRows: undefined, read: { ...read, connected: false } }),
    { ready: false, status: 'failed' },
  );
  assert.deepEqual(
    deloadChoice({ ...base, deloadRows: undefined, read: { ...read, error: 'Server error' } }),
    { ready: false, status: 'failed' },
  );
  // Rows arrived but none is deloaded: the deload is not what came back.
  assert.deepEqual(
    deloadChoice({ ...base, deloadRows: [{ deloaded: false }], read }),
    { ready: false, status: 'failed' },
  );
  // Loaded and deloaded: now it is the deload.
  assert.deepEqual(deloadChoice({ ...base, deloadRows: rowsLoaded, read }), { ready: true, status: 'idle' });
  // Nothing asked: nothing to say.
  assert.deepEqual(
    deloadChoice({ ...base, requested: false, deloadRows: undefined, read }),
    { ready: false, status: 'idle' },
  );
  // A prescribed deload already arrives deloaded on the full read.
  assert.deepEqual(
    deloadChoice({ requested: true, prescribedDeload: true, deloadRows: undefined, fullRows: rowsLoaded, read: { ...read, loading: true } }),
    { ready: true, status: 'idle' },
  );
  assert.equal(DELOAD_FAILED, 'Could not load the deload. You are on the full plan.');
});

test('while the deload loads the card keeps the full header and shows the link busy; a failure is in the card', () => {
  const loading = planStartModel(input({ deloadLoading: true }))!;
  assert.equal(loading.header, "Today's plan · Accumulation · Session 2");
  assert.equal(loading.start.label, 'Start workout');
  assert.deepEqual(loading.link, { kind: 'deload', label: 'Deload today instead', busy: true });
  const failed = planStartModel(input({ deloadFailure: DELOAD_FAILED }))!;
  assert.equal(failed.failure, DELOAD_FAILED);
  assert.equal(failed.start.label, 'Start workout');
  assert.equal(failed.link?.kind, 'deload');
});

// 4. The arrow is like for like.
const done = (id: string, weights: string[], over: Record<string, unknown> = {}) => ({
  id,
  exerciseType: 'weighted',
  weightUnit: 'kg' as const,
  sets: weights.map((weight) => ({ weight, completedAt: 1 })),
  ...over,
});
const workoutOf = (sessionId: string, startedAt: number, exercises: unknown[], over: Record<string, unknown> = {}) =>
  ({ sessionId, status: 'completed', intensityMode: 'full', startedAt, exercises, ...over }) as never;

test('the arrow compares with the last completed, non-deload workout of THIS session', () => {
  const journal = [
    workoutOf('s1', 100, [done('a', ['70', '75'])]),
    workoutOf('s1', 200, [done('a', ['40'])], { intensityMode: 'deload' }),
    workoutOf('s2', 300, [done('a', ['20'])]),
    workoutOf('s1', 150, [done('a', ['72.5'])]),
    workoutOf('s1', 400, [done('a', ['99'])], { status: 'active' }),
  ];
  assert.deepEqual(lastComparableLoads(journal, 's1', {}), { a: 72.5 });
  // The newest comparable workout wins.
  assert.deepEqual(lastComparableLoads([...journal, workoutOf('s1', 250, [done('a', ['77.5'])])], 's1', {}), { a: 77.5 });
});

test('after a deload day the next full day is not compared with the deload', () => {
  const journal = [
    workoutOf('s1', 100, [done('a', ['80'])]),
    workoutOf('s1', 200, [done('a', ['50'])], { intensityMode: 'deload' }),
  ];
  const tops = lastComparableLoads(journal, 's1', {});
  const model = planStartModel(input({ exercises: [lift('a')], previousTops: tops }))!;
  // 82.5 today against 80 last full time: +2.5, not +32.5 against the deload.
  assert.deepEqual(model.rows[0]!.change, { direction: 'up', amount: '2.5' });
});

test('no comparison for a bodyweight lift, a skipped one, no completed sets, or another unit', () => {
  const journal = [
    workoutOf('s1', 100, [
      done('pull', ['0'], { exerciseType: 'bodyweight' }),
      done('skip', ['80'], { skipped: true }),
      done('none', ['80'].slice(1)),
      done('lb', ['80'], { weightUnit: 'lb' }),
      { ...done('open', ['80']), sets: [{ weight: '80', completedAt: null }] },
    ]),
  ];
  assert.deepEqual(lastComparableLoads(journal, 's1', { lb: 'kg' }), {});
  // The same lift read in pounds both times compares.
  assert.deepEqual(lastComparableLoads(journal, 's1', { lb: 'lb' }), { lb: 80 });
});

test('no arrow on a deload day, a deloaded lift, an unloaded lift, or when a number is missing', () => {
  const previousTops = { a: 70, b: 70, c: 70, w: 70 };
  const rows = [lift('a'), lift('b', { deloaded: true }), lift('w', { exerciseType: 'bodyweight', estimated1rm: null }), lift('d')];
  const model = planStartModel(input({ exercises: rows, asSent: rows, previousTops }))!;
  assert.deepEqual(model.rows[0]!.change, { direction: 'up', amount: '12.5' });
  assert.equal(model.rows[1]!.change, null);
  assert.equal(model.rows[2]!.change, null);
  assert.equal(model.rows[3]!.change, null);
  const deloadDay = planStartModel(
    input({ deloadChosen: true, exercises: [lift('a')], asSent: [lift('a')], previousTops }),
  )!;
  assert.equal(deloadDay.rows[0]!.change, null);
  assert.equal(planStartModel(input({ exercises: [lift('a')], previousTops: { a: 0 } }))!.rows[0]!.change, null);
});

test('the server\'s last log of a lift (lastWeights) no longer drives an arrow', () => {
  const model = planStartModel(input({ exercises: [lift('a', { lastWeights: [20] })] }))!;
  assert.equal(model.rows[0]!.change, null);
});

// 5. A pending plan explains nothing it is not driving.
test('a pending plan hides its reason and notes; its waiting move keeps its note and Accept', () => {
  const note = 'Lighter today.';
  const prescription = {
    phase: 'intensification',
    phaseAction: 'transition_recommended',
    reasoning: 'You are ready to move on.',
    deload: false,
    estimatedSessionDurationMin: 60,
    exercises: [{ sessionExerciseId: 'a', autoregNote: note }],
  };
  const pending = planStartModel(input({ prescription, prescriptionStatus: 'pending' }))!;
  assert.equal(pending.reason, null);
  assert.equal(pending.rows[0]!.note, null);
  assert.deepEqual(pending.suggestion?.action, { kind: 'accept', label: 'Accept move to Intensification' });
  const applied = planStartModel(input({ prescription, prescriptionStatus: 'auto_applied' }))!;
  assert.equal(applied.reason, 'You are ready to move on.');
  assert.equal(applied.rows[0]!.note, note);
});

// 6. Smaller things.
test('a deloaded lift shows its deload note, whole; a full lift keeps its own note', () => {
  const rows = [lift('a', { deloaded: true }), lift('b')];
  const prescription = {
    ...prescribedDeload(),
    exercises: [
      { sessionExerciseId: 'a', autoregNote: 'ignored', deloadNote: 'Two light sets: the joint is still sore.' },
      { sessionExerciseId: 'b', autoregNote: 'Holding steady.' },
    ],
  };
  const model = planStartModel(input({ exercises: rows, asSent: rows, prescription, deloadChosen: true }))!;
  assert.equal(model.rows[0]!.note, 'Two light sets: the joint is still sore.');
  assert.equal(model.rows[1]!.note, 'Holding steady.');
});

test('notes behind "+ N more" are counted, and the preparing line sits in the card', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => lift(id));
  const prescription = {
    ...prescribedDeload(),
    deload: false,
    phase: 'accumulation',
    phaseAction: 'stay',
    exercises: [
      { sessionExerciseId: 'a', autoregNote: 'one' },
      { sessionExerciseId: 'd', autoregNote: 'two' },
      { sessionExerciseId: 'e', autoregNote: 'three' },
    ],
  };
  const model = planStartModel(input({ exercises: rows, asSent: rows, prescription, preparing: true }))!;
  assert.equal(model.notesBehindMore, 2);
  assert.ok(model.notes.some((line) => line.includes('numbers may change in a moment')));
  assert.equal(planStartModel(input({ preparing: false }))!.notes.length, 0);
});

test('an AI program\'s editor and builder no longer offer Auto-apply, and the manual phase row says it is an override', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path: string) => readFileSync(new URL(`../src/features/programs/${path}`, import.meta.url), 'utf8');
  assert.ok(!read('ProgramEditor.tsx').includes('Auto-apply'));
  assert.ok(!read('AIProgramBuilder.tsx').includes('Auto-apply'));
  const row = read('ProgramPhaseRow.tsx');
  assert.ok(row.includes('Change phase manually'));
  assert.ok(row.includes('override'));
  // Still reachable: the active AI program's editor draws it.
  assert.match(read('ProgramEditor.tsx'), /program\?\.isActive && program\.phaseMode === 'ai_dynamic'[\s\S]{0,40}<ProgramPhaseRow/);
});
