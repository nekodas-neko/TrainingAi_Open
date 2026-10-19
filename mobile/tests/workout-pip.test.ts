import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  allowsPip,
  pipClock,
  pipCommand,
  pipPhaseFor,
  pipViewFor,
  type PipView,
} from '../src/features/workouts/pip/pip.ts';
import type { WorkoutRecord } from '../src/features/workouts/logging/workout.ts';

const require = createRequire(import.meta.url);

const T0 = Date.UTC(2026, 9, 19, 8);
const ids = {
  workout: '00000000-0000-4000-8000-000000000001',
  bench: '00000000-0000-4000-8000-000000000002',
  row: '00000000-0000-4000-8000-000000000003',
  set: (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
};

function set(n: number, extra: Partial<WorkoutRecord['exercises'][number]['sets'][number]> = {}) {
  return {
    id: ids.set(n),
    weight: '60',
    reps: '8',
    startedAt: null,
    completedAt: null,
    restAfterSec: null,
    planned: { number: n, reps: 8, percent: 70, restSeconds: 90 },
    plannedWeight: 60,
    rpe: null,
    rpeSource: null,
    suggestionHandled: false,
    ...extra,
  };
}
function workout(extra: Partial<WorkoutRecord> = {}): WorkoutRecord {
  const exercise = (id: string, name: string, first: number) => ({
    id,
    logId: id,
    name,
    weightUnit: 'kg' as const,
    sets: [set(first), set(first + 1), set(first + 2)],
  });
  return {
    id: ids.workout,
    status: 'active',
    startedAt: T0,
    restAdjustmentSeconds: 0,
    restAnchor: null,
    rest: null,
    runningSet: null,
    flow: { stage: 'exercise', exerciseId: ids.bench },
    exercises: [exercise(ids.bench, 'Bench press', 1), exercise(ids.row, 'Barbell row', 4)],
    ...extra,
  } as unknown as WorkoutRecord;
}
/** Bench press with its first `count` sets recorded, a minute apart. */
function recorded(count: number, extra: Partial<WorkoutRecord> = {}) {
  const base = workout(extra);
  const bench = base.exercises[0];
  bench.sets = bench.sets.map((x, i) =>
    i < count ? { ...x, startedAt: T0 + i * 60_000, completedAt: T0 + i * 60_000 + 30_000 } : x,
  );
  return base;
}
const timer = (view: PipView | null) => {
  assert.equal(view?.kind, 'timer');
  return view as Extract<PipView, { kind: 'timer' }>;
};

test('only an active workout past its warm-up opens the window (#2908)', () => {
  assert.equal(pipPhaseFor(null), 'idle');
  assert.equal(pipPhaseFor(workout({ status: 'completed' })), 'idle');
  assert.equal(pipPhaseFor(workout({ flow: { stage: 'warmup', exerciseId: ids.bench } })), 'pre');
  assert.equal(pipPhaseFor(workout({ flow: { stage: 'review', exerciseId: ids.bench } })), 'done');
  assert.equal(pipPhaseFor(workout()), 'rest');
  assert.equal(
    pipPhaseFor(workout({ runningSet: { exerciseId: ids.bench, setId: ids.set(1) } })),
    'set',
  );
  assert.equal(
    pipPhaseFor(workout({ flow: { stage: 'summary', exerciseId: ids.bench } })),
    'summary',
  );
  assert.equal(pipPhaseFor(recorded(3)), 'complete');
  assert.deepEqual(
    (['idle', 'pre', 'set', 'rest', 'complete', 'summary', 'done'] as const).filter(allowsPip),
    ['set', 'rest', 'complete', 'summary'],
  );
});

test('resting shows the elapsed rest against its target and the sets done', () => {
  const view = timer(
    pipViewFor(
      recorded(2, {
        restAnchor: { exerciseId: ids.bench, setId: ids.set(2), startedAt: T0 + 90_000 },
        rest: {
          exerciseId: ids.bench,
          setId: ids.set(2),
          startedAt: T0 + 90_000,
          endsAt: T0 + 180_000,
        },
      }),
    ),
  );
  assert.deepEqual(
    [view.exerciseName, view.phase, view.currentSet, view.sets, view.restTargetSec],
    ['Bench press', 'rest', 2, 3, 90],
  );
  const early = pipClock(view, T0 + 90_000 + 45_500);
  assert.deepEqual(
    [early.seconds, early.overTime, early.fraction, early.label],
    [45, false, 0.5, 'rest · 2/3'],
  );
  const late = pipClock(view, T0 + 90_000 + 100_000);
  assert.deepEqual([late.seconds, late.overTime, late.over, late.fraction], [100, true, 10, 1]);
});

test('a running set shows its time, its number and the load', () => {
  const base = recorded(1, { runningSet: { exerciseId: ids.bench, setId: ids.set(2) } });
  base.exercises[0].sets[1] = {
    ...base.exercises[0].sets[1],
    startedAt: T0 + 100_000,
    weight: '62.5',
    reps: '6',
  };
  const view = timer(pipViewFor(base));
  assert.equal(view.load, '62.5 kg × 6');
  const clock = pipClock(view, T0 + 100_000 + 90_000);
  assert.deepEqual([clock.seconds, clock.fraction, clock.label], [90, 0.5, 'set 2/3']);
  assert.equal(pipClock(view, T0 + 100_000 + 400_000).fraction, 1, 'capped at three minutes');
});

test('the exercise summary times the last set’s rest, or shows the placeholder', () => {
  const summary = recorded(3, { flow: { stage: 'summary', exerciseId: ids.bench } });
  const view = timer(pipViewFor(summary));
  assert.deepEqual([view.restStartMs, view.restTargetSec], [T0 + 150_000, 90]);
  assert.equal(pipClock(view, T0 + 160_000).label, 'done');
  assert.deepEqual(pipViewFor(workout({ flow: { stage: 'summary', exerciseId: ids.bench } })), {
    kind: 'placeholder',
    exerciseName: 'Bench press',
  });
  assert.equal(pipViewFor(workout({ flow: { stage: 'warmup', exerciseId: ids.bench } })), null);
});

test('the window buttons act as the current app’s', () => {
  const running = recorded(1, { runningSet: { exerciseId: ids.bench, setId: ids.set(2) } });
  assert.deepEqual(pipCommand(running, 'repsUp'), {
    type: 'reps',
    exerciseId: ids.bench,
    setId: ids.set(2),
    value: '9',
  });
  running.exercises[0].sets[1].reps = '1';
  assert.equal((pipCommand(running, 'repsDown') as { value: string }).value, '1', 'never below 1');
  running.exercises[0].sets[1].reps = '';
  assert.equal((pipCommand(running, 'repsDown') as { value: string }).value, '7', 'from the plan');
  assert.deepEqual(pipCommand(running, 'log'), {
    type: 'record',
    exerciseId: ids.bench,
    setId: ids.set(2),
  });

  assert.deepEqual(pipCommand(recorded(1), 'log'), {
    type: 'start',
    exerciseId: ids.bench,
    setId: ids.set(2),
  });
  assert.equal(pipCommand(recorded(1), 'repsUp'), null, 'rest has only Start Set');
  assert.deepEqual(
    pipCommand(recorded(3, { flow: { stage: 'summary', exerciseId: ids.bench } }), 'log'),
    {
      type: 'advance',
    },
  );
  assert.equal(
    pipCommand(workout({ flow: { stage: 'warmup', exerciseId: ids.bench } }), 'log'),
    null,
  );
  assert.equal(pipCommand(null, 'log'), null);
});

test('the manifest change declares PiP once, however often prebuild runs', () => {
  const plugin = require('../src/integrations/pip/picture-in-picture.cjs') as {
    enablePictureInPicture: (manifest: unknown) => unknown;
  };
  const main = {
    $: {
      'android:name': '.MainActivity',
      'android:configChanges': 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode',
    },
    'intent-filter': [
      {
        action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
        category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
      },
    ],
  };
  const manifest = {
    manifest: { application: [{ $: { 'android:name': '.MainApplication' }, activity: [main] }] },
  };
  plugin.enablePictureInPicture(manifest);
  const once = JSON.stringify(manifest);
  plugin.enablePictureInPicture(manifest);
  assert.equal(JSON.stringify(manifest), once);
  assert.equal(main.$['android:supportsPictureInPicture' as keyof typeof main.$], 'true');
  assert.equal(
    main.$['android:configChanges'],
    'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize',
  );
});

test('a window button reaches the journal', async () => {
  const { runPipAction } = await import('../src/features/workouts/pip/usePictureInPicture.ts');
  const calls: unknown[][] = [];
  const controller = {
    updateSet: (...args: unknown[]) => void calls.push(['updateSet', ...args]),
    recordSet: async (...args: unknown[]) => void calls.push(['recordSet', ...args]),
    startSet: async (...args: unknown[]) => void calls.push(['startSet', ...args]),
    advanceExercise: async (...args: unknown[]) => void calls.push(['advanceExercise', ...args]),
  } as unknown as Parameters<typeof runPipAction>[1];
  const running = recorded(1, { runningSet: { exerciseId: ids.bench, setId: ids.set(2) } });
  runPipAction(running, controller, 'repsDown');
  runPipAction(running, controller, 'log');
  runPipAction(recorded(1), controller, 'log');
  runPipAction(
    recorded(3, { flow: { stage: 'summary', exerciseId: ids.bench } }),
    controller,
    'log',
  );
  runPipAction(recorded(1), controller, 'repsUp');
  assert.deepEqual(calls, [
    ['updateSet', ids.workout, ids.bench, ids.set(2), 'reps', '7'],
    ['recordSet', ids.workout, ids.bench, ids.set(2)],
    ['startSet', ids.workout, ids.bench, ids.set(2)],
    ['advanceExercise', ids.workout],
  ]);
});
