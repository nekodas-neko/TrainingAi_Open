import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// #3923 review: the wiring around `onResume`, run with `react-native` and `react` swapped for the
// stub in fixtures/, so this runner can load the real modules.
const resume = new URL('../src/core/sync/resume.ts', import.meta.url).href;
const stub = new URL('./fixtures/app-state-stub.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === resume && (specifier === 'react-native' || specifier === 'react'))
      return { url: stub, shortCircuit: true };
    return next(specifier, context);
  },
});
const { onResume, onReconnect, useConnectivityProbe } = await import(resume);
const { setAppState, cleanups } = await import(stub);
const { connectivity, PROBE_INTERVAL_MS, RECONNECT_MIN_GAP_MS } = await import(
  '../src/core/sync/Connectivity.ts'
);
const { followHistoryDownload } = await import(
  '../src/features/settings/data/history-download-resume.ts'
);
const { reloadDayOnReconnect, dayKinds } = await import('../src/features/nutrition/data/reconnect.ts');
const { nutritionRefreshError } = await import('../src/features/nutrition/data/NutritionStore.ts');

const offlineError = () => new TypeError('Network request failed');
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};
// The shared signal spaces returns a minute apart; each test's return is its own.
let clock = Date.now();
function dropAndReturn() {
  clock += RECONNECT_MIN_GAP_MS;
  connectivity.failed(offlineError());
  connectivity.reached();
}
const realNow = Date.now;
Date.now = () => clock;
test.after(() => {
  Date.now = realNow;
});

test('onResume fires on a return to the foreground and on a return of the connection, until removed', () => {
  let fired = 0;
  const listener = onResume(() => fired++);
  setAppState('background');
  assert.equal(fired, 0);
  setAppState('active');
  assert.equal(fired, 1);
  dropAndReturn();
  assert.equal(fired, 2);
  listener.remove();
  setAppState('active');
  dropAndReturn();
  assert.equal(fired, 2);
});

test('onReconnect fires only on a return of the connection', () => {
  let fired = 0;
  const listener = onReconnect(() => fired++);
  setAppState('active');
  assert.equal(fired, 0);
  dropAndReturn();
  assert.equal(fired, 1);
  listener.remove();
});

test('useConnectivityProbe asks only while offline and in the foreground, and stops on unmount', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const asked: string[] = [];
  let online = false;
  const reader = {
    get: async (path: string) => {
      asked.push(path);
      if (!online) {
        connectivity.failed(offlineError());
        throw offlineError();
      }
      connectivity.reached();
      return {};
    },
  };
  useConnectivityProbe(reader);
  const unmount = cleanups.pop()!;
  t.mock.timers.tick(PROBE_INTERVAL_MS);
  await settle();
  assert.equal(asked.length, 0, 'online: nothing sent');
  connectivity.failed(offlineError());
  setAppState('background');
  t.mock.timers.tick(PROBE_INTERVAL_MS);
  await settle();
  assert.equal(asked.length, 0, 'in the background: nothing sent');
  setAppState('active');
  await settle();
  assert.deepEqual(asked, ['/api/account/data-epoch'], 'a return to the foreground asks at once');
  t.mock.timers.tick(PROBE_INTERVAL_MS);
  await settle();
  assert.equal(asked.length, 2, 'and every 10 s while still offline');
  online = true;
  clock += RECONNECT_MIN_GAP_MS;
  t.mock.timers.tick(PROBE_INTERVAL_MS);
  await settle();
  assert.equal(connectivity.isOffline(), false);
  t.mock.timers.tick(PROBE_INTERVAL_MS * 3);
  await settle();
  assert.equal(asked.length, 3, 'back online: the probe stops');
  unmount();
  connectivity.failed(offlineError());
  t.mock.timers.tick(PROBE_INTERVAL_MS * 3);
  await settle();
  assert.equal(asked.length, 3, 'unmounted: nothing more');
  clock += RECONNECT_MIN_GAP_MS;
  connectivity.reached();
});

test('a history download stopped by a drop carries on when the connection returns, uploads first', async () => {
  const order: string[] = [];
  const download = {
    resumeIfInterrupted: async () => {
      order.push('resume');
    },
  };
  const listener = followHistoryDownload(download, () => [
    Promise.resolve().then(() => order.push('upload')),
    undefined,
  ]);
  await settle();
  assert.deepEqual(order, ['upload', 'resume'], 'once on mount');
  dropAndReturn();
  await settle();
  assert.deepEqual(order, ['upload', 'resume', 'upload', 'resume'], 'and again on the return');
  listener.remove();
  dropAndReturn();
  await settle();
  assert.equal(order.length, 4);
});

test("Nutrition reloads the day's kinds on a return, without forcing fresh ones", () => {
  const calls: [string, string, boolean | undefined][] = [];
  const store = {
    refresh: (kind: string, date: string, manual?: boolean) => {
      calls.push([kind, date, manual]);
      return Promise.resolve(undefined);
    },
  };
  const listener = reloadDayOnReconnect(store as never, '2026-11-20');
  setAppState('active');
  assert.equal(calls.length, 0, 'a return to the foreground is the other listener’s job');
  dropAndReturn();
  assert.deepEqual(
    calls,
    dayKinds.map((kind: string) => [kind, '2026-11-20', undefined]),
  );
  listener.remove();
});

test('a Nutrition refresh cut off by the client timeout says it timed out', () => {
  const timeout = new Error('The request timed out.');
  timeout.name = 'TimeoutError';
  assert.match(nutritionRefreshError('logs', timeout), /timed out/);
});
