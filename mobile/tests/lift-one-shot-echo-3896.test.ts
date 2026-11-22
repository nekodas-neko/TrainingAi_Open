// #3896 step 5: Preview echoes the lift's one-shot when it logs. The server consumes a one-shot
// ("lighter / heavier next time", ±1 set) only for a log that presents the exact time its plan carried
// (`liftPreference.oneShotSetAt`); without the echo a one-shot set from the Coach would only end by
// expiry. Also: the Coach request names the gated patch domains this build renders, and this build's
// patch contract parses a lift_preference proposal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutJournalStore } from '../src/features/workouts/logging/WorkoutJournalStore.ts';
import { finishWorkout, mutationFor } from '../src/features/workouts/logging/workout.ts';
import { buildCatalog, oneShotTime } from '../src/features/workouts/catalog.ts';
import {
  CoachPatchSchema, RENDERED_PATCH_DOMAINS, GATED_PATCH_DOMAINS, liftPreferenceValueLabel,
} from '../src/features/coach/data/patch.ts';
import { sqliteFixture } from './storage-fixture.ts';
import { loggingFixture, programId, exerciseId } from './logging-fixture.ts';

const SET_AT = '2026-11-22T01:02:03.456Z';

async function logWith(t: { after(fn: () => void): void }, liftPreference: unknown) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const f = loggingFixture();
  if (liftPreference !== undefined) (f.response.exercises[0] as Record<string, unknown>).liftPreference = liftPreference;
  const session = buildCatalog(f.meta, f.next, f.all, f.reader).program!.sessions[0];
  let now = Date.UTC(2026, 10, 22, 2);
  const controller = new WorkoutJournalStore(
    storage.account(f.connection.origin, f.connection.userId), f.connection, f.uuid, () => now,
  );
  await controller.initialize();
  const id = (await controller.start(session, programId, true, {}))!;
  await controller.beginExercises(id);
  const [first] = controller.getSnapshot().data.workouts[0].exercises[0].sets;
  await controller.startSet(id, exerciseId, first.id);
  now += 30_000;
  await controller.recordSet(id, exerciseId, first.id);
  const finished = finishWorkout(controller.getSnapshot().data.workouts[0], (now += 60_000));
  const log = finished.pending.find((item) => item.domain === 'workout_log')!;
  return mutationFor(finished, log).payload as { liftOneShotSetAt?: string };
}

test('a plan that carried a one-shot: the log echoes its exact time', async (t) => {
  const payload = await logWith(t, { loadStep: 'lighter', oneShotSetAt: SET_AT });
  assert.equal(payload.liftOneShotSetAt, SET_AT);
});

test('a plan with no one-shot, or none recorded: the log names none', async (t) => {
  assert.equal((await logWith(t, undefined)).liftOneShotSetAt, undefined);
  assert.equal((await logWith(t, { repRange: { min: 12, max: 15 } })).liftOneShotSetAt, undefined);
});

test('a malformed time is dropped, never sent and never a broken catalog', async (t) => {
  assert.equal((await logWith(t, { loadStep: 'lighter', oneShotSetAt: 'yesterday' })).liftOneShotSetAt, undefined);
  assert.equal(oneShotTime(42), null);
  assert.equal(oneShotTime(`${SET_AT}x`), null);
});

test('the Coach request names the gated domains this build renders, and the contract parses one', () => {
  assert.deepEqual([...RENDERED_PATCH_DOMAINS], ['lift_preference']);
  for (const d of RENDERED_PATCH_DOMAINS) assert.ok(GATED_PATCH_DOMAINS.includes(d));
  const patch = {
    domain: 'lift_preference',
    targetId: '10000000-0000-4000-8000-000000000003',
    changes: [
      { id: 'r', field: 'repRange', from: '6-8', to: 'more_reps' },
      { id: 'l', field: 'nextLoadStep', from: null, to: 'lighter' },
    ],
  };
  assert.equal(CoachPatchSchema.safeParse(patch).success, true);
  // A weight the model added is refused by this build's contract as by the server's.
  const withWeight = { ...patch, changes: [{ ...patch.changes[0], weightKg: 40 }] };
  assert.equal(CoachPatchSchema.safeParse(withWeight).success, false);
});

test('the card reads a lift preference in words (CoachChanges.patchValue uses this first)', () => {
  assert.equal(liftPreferenceValueLabel('repRange', '12-15'), '12–15 reps');
  assert.equal(liftPreferenceValueLabel('repRange', 'more_reps'), 'More reps');
  assert.equal(liftPreferenceValueLabel('restSec', 90), '90 s');
  assert.equal(liftPreferenceValueLabel('nextLoadStep', 'lighter'), 'One plate lighter');
  assert.equal(liftPreferenceValueLabel('setsDelta', -1), 'One fewer set');
  assert.equal(liftPreferenceValueLabel('repRange', null), null);
  // Other domains' fields fall through to the card's existing formatting.
  assert.equal(liftPreferenceValueLabel('removed', true), null);
  assert.equal(liftPreferenceValueLabel('stepsGoal', 9000), null);
});
