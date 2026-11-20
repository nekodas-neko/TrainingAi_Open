import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/features/account/api/client.ts';
import {
  isSharing,
  mealSharingFailure,
  mealSharingSpec,
  MealSharingNotConfirmed,
  saveMealSharing,
} from '../src/features/nutrition/data/meal-sharing.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';

// #2218. The opt-in is a statement to other people, so the switch shows only what the server said.
function setup(server: { bag: Record<string, unknown>; online: boolean; answer?: boolean }) {
  const disk = new Map<string, string>();
  const patches: unknown[] = [];
  const storage = {
    get: async (key: string) => disk.get(key) ?? null,
    set: async (key: string, value: string) => {
      disk.set(key, value);
    },
    remove: async (key: string) => {
      disk.delete(key);
    },
  };
  const resources = new WorkoutResources(storage, {
    origin: 'https://example.com',
    userId: 'one',
    timezone: 'Australia/Brisbane',
    get: async () => {
      if (!server.online) throw new Error('offline');
      return server.bag;
    },
    post: async () => ({}),
    patch: async (_path: string, body: unknown) => {
      patches.push(body);
      if (!server.online) throw new Error('offline');
      // The server merges the change and answers with the whole bag, as the route does.
      const change = (body as { shareMealLibrary: boolean }).shareMealLibrary;
      server.bag = { ...server.bag, shareMealLibrary: server.answer ?? change };
      return server.bag;
    },
  });
  return { resources, disk, patches, server };
}
const shown = (resources: WorkoutResources) => resources.state(mealSharingSpec).data;

test('only a true from the server reads as sharing', () => {
  assert.equal(isSharing(null), false);
  assert.equal(isSharing({}), false);
  assert.equal(isSharing({ shareMealLibrary: false }), false);
  for (const odd of ['true', 'yes', 1, {}]) {
    assert.equal(isSharing({ shareMealLibrary: odd }), false);
  }
  assert.equal(isSharing({ shareMealLibrary: true }), true);
});

test('until the server has answered there is no value to show, which is not the same as off', async () => {
  const t = setup({ bag: { shareMealLibrary: true, homeWidgets: ['x'] }, online: true });
  assert.equal(shown(t.resources), null);
  await t.resources.load(mealSharingSpec, true);
  assert.equal(isSharing(shown(t.resources)), true);
  // Only the one key is held, not the rest of the preferences.
  assert.deepEqual(shown(t.resources), { shareMealLibrary: true });
});

test('a failed first read leaves the switch unknown rather than off', async () => {
  const t = setup({ bag: {}, online: false });
  await t.resources.load(mealSharingSpec, true);
  const state = t.resources.state(mealSharingSpec);
  assert.equal(state.data, null);
  assert.ok(state.error);
});

test('turning it on sends exactly the one key and shows the server\'s answer', async () => {
  const t = setup({ bag: {}, online: true });
  await t.resources.load(mealSharingSpec, true);
  assert.equal(isSharing(shown(t.resources)), false);
  assert.equal(await saveMealSharing(t.resources, true), true);
  assert.deepEqual(t.patches, [{ shareMealLibrary: true }]);
  assert.equal(isSharing(shown(t.resources)), true);
});

test('turning it off while offline is refused and the switch stays on', async () => {
  const t = setup({ bag: { shareMealLibrary: true }, online: true });
  await t.resources.load(mealSharingSpec, true);
  t.server.online = false;
  await assert.rejects(saveMealSharing(t.resources, false), /offline/);
  // Nothing was queued to send later, and the view still says what the server last said.
  assert.equal(isSharing(shown(t.resources)), true);
  assert.deepEqual(t.patches, [{ shareMealLibrary: false }]);
  assert.match(mealSharingFailure(false, new Error('offline')), /friends can still see your meals/);
});

test('a change the server did not confirm is an error, and the view shows what the server said', async () => {
  const t = setup({ bag: { shareMealLibrary: true }, online: true, answer: true });
  await t.resources.load(mealSharingSpec, true);
  await assert.rejects(saveMealSharing(t.resources, false), MealSharingNotConfirmed);
  assert.equal(isSharing(shown(t.resources)), true);
});

test('turning it off is shown only once the server has said it is off', async () => {
  const t = setup({ bag: { shareMealLibrary: true }, online: true });
  await t.resources.load(mealSharingSpec, true);
  assert.equal(await saveMealSharing(t.resources, false), false);
  assert.equal(isSharing(shown(t.resources)), false);
});

test('the setting is never saved on the phone', async () => {
  const t = setup({ bag: { shareMealLibrary: true }, online: true });
  await t.resources.load(mealSharingSpec, true);
  await saveMealSharing(t.resources, false);
  await saveMealSharing(t.resources, true);
  assert.deepEqual(
    [...t.disk.keys()].filter((key) => key.startsWith('workout-resource.v1:')),
    [],
  );
});

test('the failure sentences say what did and did not change', () => {
  assert.match(mealSharingFailure(true, new Error('offline')), /Nothing was changed/);
  assert.match(mealSharingFailure(true, new ApiError(429)), /Too many requests/);
  assert.doesNotMatch(mealSharingFailure(false, new Error('offline')), /Nothing was changed/);
});
