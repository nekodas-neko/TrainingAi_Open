import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  allowsPip,
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

test('resting sends the rest anchor, its target and the sets done', () => {
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
  assert.deepEqual(view, {
    kind: 'timer',
    exerciseName: 'Bench press',
    phase: 'rest',
    currentSet: 2,
    sets: 3,
    restTargetSec: 90,
    restStartMs: T0 + 90_000,
    setStartMs: null,
    load: null,
    setColor: null,
  });
  assert.equal(timer(pipViewFor(recorded(1))).restTargetSec, 0, 'no rest timer: no target');
});

test('a running set sends its start, the load and the set colour', () => {
  const base = recorded(1, { runningSet: { exerciseId: ids.bench, setId: ids.set(2) } });
  base.exercises[0].sets[1] = {
    ...base.exercises[0].sets[1],
    startedAt: T0 + 100_000,
    weight: '62.5',
    reps: '6',
  };
  const view = timer(pipViewFor(base));
  assert.deepEqual(
    [view.phase, view.currentSet, view.setStartMs, view.load, view.setColor],
    ['set', 1, T0 + 100_000, '62.5 kg × 6', '#a78bfa'],
  );
  // Past the six-colour table the shared palette turns oklch, which Android cannot parse.
  const many = recorded(7, { runningSet: { exerciseId: ids.bench, setId: ids.set(1) } });
  many.exercises[0].sets = [...Array(8)].map((_, i) =>
    i < 7 ? { ...set(i + 1), completedAt: T0 + i } : set(i + 1),
  );
  assert.match(timer(pipViewFor(many)).setColor ?? '', /^#[\da-f]{6}$/i);
});

test('the exercise summary shows the placeholder until Preview runs a last-set rest (#3111)', () => {
  const summary = recorded(3, { flow: { stage: 'summary', exerciseId: ids.bench } });
  assert.deepEqual(pipViewFor(summary), {
    kind: 'placeholder',
    exerciseName: 'Bench press',
    hint: true,
  });
  // Next on the last exercise ends the workout with the window still open: never blank (#3133).
  assert.deepEqual(
    pipViewFor(
      recorded(3, {
        sessionName: 'Upper body',
        flow: { stage: 'review', exerciseId: ids.bench },
      } as Partial<WorkoutRecord>),
    ),
    { kind: 'placeholder', exerciseName: 'Upper body', hint: false },
  );
  assert.equal(pipViewFor(workout({ flow: { stage: 'warmup', exerciseId: ids.bench } })), null);
});

test('the workout screen reports changes only, and idle once it closes (#2908)', async () => {
  const { createPipReporter } = await import('../src/features/workouts/pip/usePictureInPicture.ts');
  const sent: [string, unknown][] = [];
  const reporter = createPipReporter({ setPhase: (phase, view) => void sent.push([phase, view]) });
  reporter.update(recorded(1));
  reporter.update(recorded(1));
  reporter.update(recorded(1, { runningSet: { exerciseId: ids.bench, setId: ids.set(2) } }));
  assert.deepEqual(
    sent.map(([phase]) => phase),
    ['rest', 'set'],
    'a re-render with nothing new sends nothing',
  );
  assert.equal((sent[0][1] as { kind: string }).kind, 'timer');
  reporter.close();
  reporter.close();
  reporter.update(recorded(2));
  assert.deepEqual(sent.slice(2), [['idle', null]]);
  // A warm-up or a finished workout reports a phase that never opens the window, with no view.
  const later = createPipReporter({ setPhase: (phase, view) => void sent.push([phase, view]) });
  later.update(workout({ flow: { stage: 'warmup', exerciseId: ids.bench } }));
  assert.deepEqual(sent.at(-1), ['pre', null]);
  // Without the module (iOS, an older build) nothing is called and nothing throws.
  createPipReporter(null).update(recorded(1));
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

test('the load line always shows during a set, with the current app’s fallbacks (#3133)', () => {
  const base = recorded(1, { runningSet: { exerciseId: ids.bench, setId: ids.set(2) } });
  const loadOf = () => timer(pipViewFor(base)).load;
  base.exercises[0].sets[1] = { ...base.exercises[0].sets[1], weight: '', reps: '' };
  assert.equal(loadOf(), '60 kg × 8', 'blank weight: the planned weight; blank reps: the plan');
  base.exercises[0].sets[1] = {
    ...base.exercises[0].sets[1],
    plannedWeight: null,
    planned: null,
  };
  base.exercises[0].sets[0] = { ...base.exercises[0].sets[0], weight: '57.5', reps: '9' };
  assert.equal(loadOf(), '57.5 kg × 9', 'then the first set');
  base.exercises[0].sets[0] = { ...base.exercises[0].sets[0], weight: '', reps: '' };
  assert.equal(loadOf(), '60 kg × 10', 'then 60 × 10, as the current app defaults');
  base.runningSet = { exerciseId: ids.bench, setId: '00000000-0000-4000-8000-000000000999' };
  assert.notEqual(loadOf(), null, 'a missing running set still shows a load');
  base.exercises[0].weightUnit = 'lb';
  base.exercises[0].sets[0] = { ...base.exercises[0].sets[0], weight: '135' };
  assert.match(loadOf() ?? '', / lb × /);
});
