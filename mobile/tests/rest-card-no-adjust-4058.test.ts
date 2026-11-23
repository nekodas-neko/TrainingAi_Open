import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { ReactElement } from 'react';
import { createElement } from 'react';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { readJournal } from '../src/features/workouts/logging/workout.ts';
import type { WorkoutRecord } from '../src/features/workouts/logging/workout.ts';
import { exerciseId, loggingFixture, programId } from './logging-fixture.ts';
import { sqliteFixture } from './storage-fixture.ts';

// #4058: the rest view has no −30s / +30s, and a rest saved with an old manual adjustment still loads.
const at = (path: string) => new URL(path, import.meta.url).href;
const clocks = at('../src/features/workouts/components/WorkoutClocks.tsx');
const stubs = at('./fixtures/rest-card-stubs.ts');
const stubbed = new Set([
  'react-native',
  '../../../shared/ui/Pressable',
  '../../../shared/ui/touchSlop',
  '../../../shared/ui',
  '../../../shared/hooks/useClock',
  '../logging/WorkoutJournalProvider',
  '../pip/usePipSourceRect',
  '../../../shared/theme/ThemeProvider',
  './RestRing',
]);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === clocks && stubbed.has(specifier))
      return { url: stubs, shortCircuit: true };
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const { RestCard } = await import(clocks);
const { buttons } = await import(stubs);

const rest = (startedAt: number, endsAt: number) =>
  ({ id: 'w', pausedAt: null, rest: { exerciseId: 'e', setId: 's', startedAt, endsAt } }) as unknown as WorkoutRecord;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the rest view keeps the ring, the early-start hint and the actual-rest line, with no ±30s', () => {
  buttons.length = 0;
  const html = renderToStaticMarkup(
    createElement(RestCard, { workout: rest(0, 90_000), onStartSet: () => {} }),
  );
  const words = text(html);
  assert.match(html, /data-ring="0\/90"/);
  assert.match(words, /Tap to start early/);
  assert.match(words, /Actual rest 0:00 · adjusted target 1:30/);
  assert.doesNotMatch(words, /[−+-]30\s?s/);
  assert.deepEqual(buttons, [], 'the rest view draws no buttons of its own');
});

test('a journal saved with an old manual rest adjustment still loads, the adjustment ignored (#4058)', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  const scope = storage.account(f.connection.origin, f.connection.userId);
  const controller = new WorkoutJournalStore(scope, f.connection, f.uuid, () => Date.UTC(2026, 9, 20, 8));
  await controller.initialize();
  await controller.sync();
  const id = (await controller.start(f.session, programId, true))!;
  await controller.beginExercises(id);
  const [first] = controller.getSnapshot().data.workouts[0].exercises[0].sets;
  await controller.startSet(id, exerciseId, first.id);
  await controller.recordSet(id, exerciseId, first.id);
  const journal = controller.getSnapshot().data;
  const legacy = JSON.stringify({
    ...journal,
    workouts: journal.workouts.map((w) => ({ ...w, restAdjustmentSeconds: 30 })),
  });
  assert.match(legacy, /"restAdjustmentSeconds":30/);
  const loaded = readJournal(legacy, f.connection);
  assert.equal(loaded.workouts.length, 1, 'the workout is still there');
  assert.deepEqual(loaded.workouts[0].rest, journal.workouts[0].rest, 'its rest is unchanged');
  assert.equal('restAdjustmentSeconds' in loaded.workouts[0], false);
});
