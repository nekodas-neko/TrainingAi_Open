import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';

// #3896 steps 6-7: the four ways into the Coach about a lift or a session, rendered. The shared UI,
// the theme and the Coach launcher are swapped for the stand-ins in fixtures/, so each entry point is
// the real component and pressing its control records what it would open the Coach with.
const at = (path: string) => new URL(path, import.meta.url).href;
const parents = new Map([
  [at('../src/features/coach/components/LiftCoachMenu.tsx'), ['../../../shared/ui', '../CoachProvider']],
  [at('../src/features/workouts/components/NextPrescription.tsx'), ['../../../shared/ui', './ResourceCard', '../logging/WorkoutJournalProvider']],
  [at('../src/features/workouts/components/RecapLifts.tsx'), ['../../../shared/ui', '../../../shared/theme/ThemeProvider', '../../coach/CoachProvider']],
  [at('../src/features/home/components/ChangeTodayButton.tsx'), ['../../../shared/ui', '../../../shared/ui/touchSlop', '../../../shared/theme/ThemeProvider', '../../coach/CoachProvider']],
  [at('../src/features/workouts/components/SessionExerciseList.tsx'), ['react-native', '../../../shared/ui', '../../../shared/ui/TouchSurface', '../../../shared/theme/ThemeProvider', './ExerciseHeading', '../logging/targets', '../logging/WorkoutJournalProvider']],
]);
const stubs = at('./fixtures/coach-entry-stubs.ts');
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL && parents.get(context.parentURL)?.includes(specifier))
      return { url: stubs, shortCircuit: true };
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const { controls, launches, resource } = await import(stubs);
const { LiftCoachMenu, liftMenuRequests } = await import(
  '../src/features/coach/components/LiftCoachMenu.tsx'
);
const { NextPrescription } = await import('../src/features/workouts/components/NextPrescription.tsx');
const { RecapLifts, recapLifts } = await import('../src/features/workouts/components/RecapLifts.tsx');
const { ChangeTodayButton } = await import('../src/features/home/components/ChangeTodayButton.tsx');
const { SessionExerciseList } = await import(
  '../src/features/workouts/components/SessionExerciseList.tsx'
);

const LIFT = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const SESSION = '10000000-0000-4000-8000-000000000003';
const reset = () => {
  controls.clear();
  launches.length = 0;
};
const press = (label: string) => {
  const run = controls.get(label);
  assert.ok(run, `no control labelled "${label}" (have: ${[...controls.keys()].join(', ')})`);
  run();
};
const lift = { origin: 'exercise', sessionExerciseId: LIFT };

test('the "…" menu leads with "Ask Coach about this lift", then the two shortcuts', () => {
  reset();
  const html = renderToStaticMarkup(
    createElement(LiftCoachMenu, { sessionExerciseId: LIFT, name: 'Cable Pulldown' }),
  );
  assert.match(html, /aria-label="More for Cable Pulldown"/);
  assert.deepEqual(
    [...html.matchAll(/<button>([^<]+)<\/button>/g)].map((m) => m[1]),
    ['Ask Coach about this lift', 'More reps, less weight', 'Swap exercise'],
  );
  press('menu:Ask Coach about this lift');
  press('menu:More reps, less weight');
  press('menu:Swap exercise');
  assert.deepEqual(launches, [
    { context: lift },
    { context: lift, chip: 'more_reps' },
    { context: lift, chip: 'swap' },
  ]);
  // Ids only: nothing the client says about the lift goes with it.
  assert.deepEqual(liftMenuRequests(LIFT).map((r: { request: { context?: object } }) => Object.keys(r.request.context ?? {})), [
    ['origin', 'sessionExerciseId'],
    ['origin', 'sessionExerciseId'],
    ['origin', 'sessionExerciseId'],
  ]);
});

test('entry 1: each exercise row in a workout session carries its own "…"', () => {
  reset();
  const exercise = (id: string, name: string) => ({
    id, name, muscles: [], mainMuscles: [], secondaryMuscles: [], setCount: 3, style: null,
    lastReps: [], lastWeights: [], lastDate: null, deloaded: false, supersetGroup: null,
  }) as never;
  const html = renderToStaticMarkup(
    createElement(SessionExerciseList, {
      exercises: [exercise(LIFT, 'Cable Pulldown'), exercise(OTHER, 'Row')],
      onSelect: () => {},
      trailing: (e: { id: string; name: string }) =>
        createElement(LiftCoachMenu, { sessionExerciseId: e.id, name: e.name }),
    }),
  );
  assert.match(html, /More for Cable Pulldown/);
  assert.match(html, /More for Row/);
  press('menu:Ask Coach about this lift');
  assert.deepEqual(launches.at(-1), { context: { origin: 'exercise', sessionExerciseId: OTHER } });
  // Without `trailing` (the warm-up list) the rows are as they were.
  reset();
  const plain = renderToStaticMarkup(
    createElement(SessionExerciseList, { exercises: [exercise(LIFT, 'Cable Pulldown')] }),
  );
  assert.doesNotMatch(plain, /More for/);
});

test('entry 2: "Change today" on the session card opens the Coach about that session', () => {
  reset();
  const html = renderToStaticMarkup(createElement(ChangeTodayButton, { programSessionId: SESSION }));
  assert.match(html, /Change today/);
  press("Change today's session with the Coach");
  assert.deepEqual(launches, [{ context: { origin: 'session', programSessionId: SESSION } }]);
});

test('entry 3: "Adjust" beside each lift done on the recap, without archived, re-logged or untouched ones', () => {
  reset();
  const done = [{ completedAt: 1 }];
  const workout = {
    exercises: [
      { id: LIFT, name: 'Cable Pulldown', retired: false, relogOf: null, skipped: false, sets: done },
      { id: OTHER, name: 'Row', retired: false, relogOf: null, skipped: false, sets: done },
      { id: '10000000-0000-4000-8000-000000000009', name: 'Row', retired: false, relogOf: OTHER, skipped: false, sets: done },
      { id: '10000000-0000-4000-8000-000000000008', name: 'Curl', retired: true, relogOf: null, skipped: false, sets: done },
      // Finished early before any set of it: nothing to adjust from this workout.
      { id: '10000000-0000-4000-8000-000000000007', name: 'Press', retired: false, relogOf: null, skipped: false, sets: [{ completedAt: null }] },
    ],
  } as never;
  assert.deepEqual(recapLifts(workout).map((l: { name: string }) => l.name), ['Cable Pulldown', 'Row']);
  const html = renderToStaticMarkup(createElement(RecapLifts, { workout }));
  assert.match(html, /Your lifts/);
  assert.equal(html.match(/>Adjust</g)?.length, 2);
  press('Adjust Cable Pulldown');
  assert.deepEqual(launches, [{ context: lift }]);
  reset();
  assert.equal(renderToStaticMarkup(createElement(RecapLifts, { workout: { exercises: [] } })), '');
});

test('entry 4: a "…" beside each lift on the Next workout card, only where the server sent its id', () => {
  reset();
  resource.data = {
    isRestDay: false,
    sessionName: 'Upper',
    source: 'driving',
    exercises: [
      { name: 'Cable Pulldown', sessionExerciseId: LIFT, exerciseType: 'weighted', sets: [{ weightKg: 50, reps: 8, restSec: 90 }] },
      // A server from before this change sends no id; that row shows no menu.
      { name: 'Row', exerciseType: 'weighted', sets: [{ weightKg: 40, reps: 10, restSec: 90 }] },
    ],
  };
  const html = renderToStaticMarkup(createElement(NextPrescription));
  assert.match(html, /More for Cable Pulldown/);
  assert.doesNotMatch(html, /More for Row/);
  assert.match(html, /50 kg × 8/);
  press('menu:Ask Coach about this lift');
  assert.deepEqual(launches, [{ context: lift }]);
});
