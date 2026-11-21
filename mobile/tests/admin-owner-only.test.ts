import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/features/account/api/client.ts';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutResources, type ResourceSpec } from '../src/features/workouts/data/WorkoutResources.ts';
import { adminErrorsSpec, isOwnerOnlyRefusal } from '../src/features/admin/data/admin-monitoring.ts';
import { adminFeedbackSpec } from '../src/features/admin/data/admin-users.ts';
import { sqliteFixture } from './storage-fixture.ts';

// #3951: the server serves error events and feedback to the owner only. Another admin's console
// gets the server's 403 and must say "owner only", not the generic "check your account" (which reads
// as a sign-in problem) and not an empty list.
test('a refused admin read says it is owner only; other views keep the generic refusal', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const connection = {
    origin: 'https://example.com',
    userId: 'second-admin',
    timezone: null,
    get: async (path: string) => {
      // The server's refusal: JSON `{ error: 'Forbidden' }`, which the client marks as our own shape.
      throw new ApiError(403, undefined, 'Forbidden', path, true);
    },
    post: async () => ({}),
  };
  const resources = new WorkoutResources(storage.account(connection.origin, connection.userId), connection, () => 1_000);
  const refused = async <T,>(spec: ResourceSpec<T>) => {
    await resources.load(spec);
    const state = resources.state(spec);
    assert.equal(state.data, null, spec.path);
    assert.match(state.error ?? '', /^Owner only\./, spec.path);
  };
  await refused(adminErrorsSpec);
  await refused(adminFeedbackSpec);
  const plain = { path: '/api/admin/users', schema: adminFeedbackSpec.schema };
  await resources.load(plain);
  assert.equal(resources.state(plain).error, 'Check your account to access this view.');
});

// #3957 review: `deniedMessage` is the 403 text only. A 401 (an expired sign-in) on the same view
// must not read "Owner only.", or the owner would be told their own tool is not theirs.
test('a 401 on an owner-only view keeps the generic refusal, not "Owner only."', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const connection = {
    origin: 'https://example.com',
    userId: 'owner',
    timezone: null,
    get: async (path: string) => {
      throw new ApiError(401, undefined, 'Unauthorized', path, true);
    },
    post: async () => ({}),
  };
  const resources = new WorkoutResources(storage.account(connection.origin, connection.userId), connection, () => 1_000);
  for (const spec of [adminErrorsSpec, adminFeedbackSpec] as ResourceSpec<unknown>[]) {
    await resources.load(spec);
    const state = resources.state(spec);
    assert.equal(state.data, null, spec.path);
    assert.equal(state.error, 'Check your account to access this view.', spec.path);
  }
});

// #3957 review: the console shows the owner-only refusal as a plain state with no Retry, and keeps
// "Could not load" + Retry for a real failure, a 401, or a view without owner-only text.
test('only the 403 owner-only state counts as an owner-only refusal', () => {
  const owner = adminErrorsSpec.deniedMessage;
  assert.equal(isOwnerOnlyRefusal({ data: null, error: owner }, adminErrorsSpec), true);
  assert.equal(isOwnerOnlyRefusal({ data: null, error: 'Check your account to access this view.' }, adminErrorsSpec), false);
  assert.equal(isOwnerOnlyRefusal({ data: null, error: 'Could not load this view. Check your connection and retry.' }, adminErrorsSpec), false);
  assert.equal(isOwnerOnlyRefusal({ data: null, error: owner }, null), false);
  assert.equal(isOwnerOnlyRefusal({ data: null, error: owner }, { path: '/api/admin/users' } as { deniedMessage?: string }), false);
  assert.equal(isOwnerOnlyRefusal({ data: null, error: null }, adminFeedbackSpec), false);
});
