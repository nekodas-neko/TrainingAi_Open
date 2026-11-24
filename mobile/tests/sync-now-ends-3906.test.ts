import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SYNC_NOW_END_MS,
  SYNC_NOW_LIMIT_MS,
  SYNC_NOW_SLOW,
  SYNC_STEP_LIMIT_MS,
  syncNowRunner,
  waitingText,
  type SyncBoard,
} from '../src/core/sync/deadline.ts';

// #3906 L11 #74: Sync now always ends, and says what finished and what did not.
function view() {
  const v = { busy: false, error: null as string | null, message: null as string | null };
  return {
    v,
    api: {
      setBusy: (b: boolean) => void (v.busy = b),
      setError: (e: string | null) => void (v.error = e),
      setMessage: (m: string | null) => void (v.message = m),
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};
const done = 'Sync finished.';
// Mirrors the hook: every store is one named step.
const stores =
  (steps: Record<string, (() => Promise<unknown>) | undefined>) => async (board: SyncBoard) => {
    await Promise.all(Object.entries(steps).map(([label, work]) => board.step(label, work)));
    return done;
  };

test('a store that never answers does not keep Sync now busy, and the message names it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, api } = view();
  const run = syncNowRunner(api);
  const pending = run(stores({ Nutrition: () => new Promise(() => {}), Home: async () => {} }));
  assert.equal(v.busy, true);
  await flush();
  t.mock.timers.tick(SYNC_STEP_LIMIT_MS);
  await pending;
  assert.equal(v.busy, false, 'the step bound ended the run before the 45 s notice was due');
  assert.equal(v.busy, false);
  assert.match(v.error ?? '', /Still waiting: Nutrition \(no answer yet\)/);
  assert.doesNotMatch(v.error ?? '', /Home/);
  assert.equal(v.message, null);
});

test('the whole run has an end even when a step is outside any bound', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, api } = view();
  const run = syncNowRunner(api);
  const pending = run(async (board) => {
    void board.step('Account views', () => new Promise(() => {}), 10 * SYNC_NOW_END_MS);
    await new Promise(() => {});
    return done;
  });
  t.mock.timers.tick(SYNC_NOW_LIMIT_MS);
  await flush();
  assert.equal(v.busy, true, 'still running at the notice');
  assert.equal(v.message, SYNC_NOW_SLOW);
  t.mock.timers.tick(SYNC_NOW_END_MS - SYNC_NOW_LIMIT_MS);
  await pending;
  assert.equal(v.busy, false);
  assert.match(v.error ?? '', /Account views \(no answer yet\)/);
  assert.ok(SYNC_STEP_LIMIT_MS < SYNC_NOW_LIMIT_MS);
});

test('a throwing store is named with its reason, the others still count as done', async () => {
  const { v, api } = view();
  await syncNowRunner(api)(
    stores({
      Activities: async () => {
        throw new Error('Server error 500.');
      },
      Home: async () => {},
    }),
  );
  assert.equal(v.busy, false);
  assert.equal(v.error, waitingText([{ label: 'Activities', reason: 'server error 500' }]));
  assert.match(v.error ?? '', /saved on this phone/);
});

test('a busy server answer is reported as waiting, not as uploaded', async () => {
  const { v, api } = view();
  await syncNowRunner(api)(async (board) => {
    await board.step('Training', async () => {});
    board.fail('Training', 'The server is busy. Try again shortly.');
    return done;
  });
  assert.match(v.error ?? '', /Training \(the server is busy\. try again shortly\)/);
  assert.equal(v.message, null, 'no success text over a waiting change');
});

test('all uploaded says so', async () => {
  const { v, api } = view();
  await syncNowRunner(api)(stores({ Home: async () => {}, Health: undefined }));
  assert.equal(v.message, done);
  assert.equal(v.error, null);
  assert.equal(v.busy, false);
});

test('a second tap while one runs does not start another, and a later one can', async () => {
  const { v, api } = view();
  const run = syncNowRunner(api);
  let starts = 0,
    release: () => void = () => {};
  const start = async (board: SyncBoard) => {
    starts++;
    await board.step('Home', () => new Promise<void>((resolve) => (release = resolve)));
    return done;
  };
  const first = run(start),
    second = run(start);
  assert.equal(starts, 1);
  assert.equal(first, second, 'the second tap gets the run already going');
  release();
  await first;
  assert.equal(v.busy, false);
  await run(async () => done);
  assert.equal(v.message, done);
  const third = run(start);
  assert.equal(starts, 2);
  release();
  await third;
});

test('a run abandoned at its end says it stopped waiting, and the notice catches up when it finally settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, api } = view();
  let finish: (m: string) => void = () => {};
  const pending = syncNowRunner(api)(() => new Promise<string>((resolve) => (finish = resolve)));
  t.mock.timers.tick(SYNC_NOW_END_MS);
  await pending;
  assert.equal(v.busy, false);
  assert.ok(v.error, 'an end with no step to blame still says it stopped waiting');
  finish(done);
  await flush();
  assert.equal(v.busy, false, 'a late finish never makes the button busy again');
  assert.equal(v.error, null, 'the notice no longer claims anything is waiting');
  assert.equal(v.message, done);
});
