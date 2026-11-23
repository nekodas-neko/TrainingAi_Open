import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createApiClient } from '../src/features/account/api/client.ts';
import { COACH_BUSY_TEXT, coachError } from '../src/features/coach/data/models.ts';
import { WeeklyCheckinActions } from '../src/features/home/data/weekly-checkin-actions.ts';

// #4084. The two 409 bodies of /api/coach/apply, word for word from the route:
const STALE = { error: 'This suggestion is out of date', drift: [{ field: 'x' }] };
const BUSY = {
  error: 'Another change to this is still saving. Nothing was changed; try again in a moment.',
  busy: true,
};
const OUT_OF_DATE = 'This suggestion is out of date. Ask Coach for a fresh one.';

async function applyAnswered(t: { mock: { method: Function } }, body: unknown) {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify(body), { status: 409, headers: { 'content-type': 'application/json' } }),
  );
  try {
    await createApiClient('https://example.com', async () => 'token').post('/api/coach/apply', {});
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('the apply was not refused');
}

test('a stale 409 still says the suggestion is out of date', async (t) => {
  const error = await applyAnswered(t, STALE);
  assert.equal(error.busy, false);
  assert.equal(coachError(error, 'apply this change'), OUT_OF_DATE);
});
test('a busy 409 says another change was saving, nothing changed, and to tap Apply again', async (t) => {
  const error = await applyAnswered(t, BUSY);
  assert.equal(error.busy, true);
  const text = coachError(error, 'apply this change');
  assert.equal(text, COACH_BUSY_TEXT);
  assert.match(text, /saving another change/);
  assert.match(text, /Tap Apply again/);
  assert.doesNotMatch(text, /out of date/i);
});
test('an older server answers 409 with no busy flag and reads as stale', async (t) => {
  const error = await applyAnswered(t, { error: 'This suggestion is out of date' });
  assert.equal(error.busy, false);
  assert.equal(coachError(error), OUT_OF_DATE);
  const bare = await applyAnswered(t, {});
  assert.equal(coachError(bare), OUT_OF_DATE);
});
test('the flag is read only from a 409, and only when it is exactly true', async (t) => {
  for (const flag of ['true', 1, null]) {
    const error = await applyAnswered(t, { ...BUSY, busy: flag });
    assert.equal(error.busy, false);
  }
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify(BUSY), { status: 400, headers: { 'content-type': 'application/json' } }),
  );
  const other = await createApiClient('https://example.com', async () => 'token')
    .post('/api/coach/apply', {})
    .catch((e: ApiError) => e);
  assert.equal((other as ApiError).busy, false);
});
test('the busy answer is not retried by the client', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify(BUSY), { status: 409, headers: { 'content-type': 'application/json' } });
  });
  await createApiClient('https://example.com', async () => 'token')
    .post('/api/coach/apply', {})
    .catch(() => {});
  assert.equal(calls, 1);
});

// The weekly check-in's save refuses with `code: 'stale'` both when the check-in changed and when the
// save was busy. Its own server sentence is shown as written, and says which.
const checkin = (failure: ApiError) => {
  let loads = 0;
  const resources = {
    write: async () => {
      throw failure;
    },
    load: async () => {
      loads++;
    },
    replace: async () => {},
  };
  const actions = new WeeklyCheckinActions(resources as never, {} as never, () => {}, () => false);
  return { actions, loads: () => loads };
};
test('a busy weekly check-in save shows the server\'s try-again sentence, not "changed"', async () => {
  const message = 'Another change is still saving; nothing was saved. Try again in a moment.';
  const failure = new ApiError(409, 'stale', undefined, '/api/weekly-checkin/save', true, message);
  const result = await checkin(failure).actions.save({} as never);
  assert.deepEqual(result, { ok: false, message });
  assert.doesNotMatch(String(result.ok === false && result.message), /out of date|changed/i);
});
test('a check-in that really changed keeps its own sentence', async () => {
  const failure = new ApiError(409, 'stale', undefined, '/api/weekly-checkin/save', true, 'The check-in changed; try again');
  const result = await checkin(failure).actions.save({} as never);
  assert.deepEqual(result, { ok: false, message: 'The check-in changed; try again' });
});
