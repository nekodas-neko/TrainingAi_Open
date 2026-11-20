import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { sqliteFixture } from './storage-fixture.ts';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { WorkoutResources } from '../src/features/workouts/data/WorkoutResources.ts';
import { ApiError, createApiClient } from '../src/features/account/api/client.ts';
import {
  Connectivity,
  connectivity,
  probeWhileOffline,
} from '../src/core/sync/Connectivity.ts';
import { RefreshPolicy } from '../src/core/sync/RefreshPolicy.ts';
import { withDeadline, SYNC_NOW_SLOW } from '../src/core/sync/deadline.ts';

const offlineError = () => new TypeError('Network request failed');

test('#3913: no answer marks the phone offline, any answer marks it online and tells subscribers once', () => {
  const network = new Connectivity();
  let told = 0;
  network.subscribe(() => told++);
  network.failed(new ApiError(500));
  assert.equal(network.isOffline(), false, 'an error status is still an answer');
  network.failed(offlineError());
  assert.equal(network.isOffline(), true);
  const before = network.generation();
  network.reached();
  network.reached();
  assert.equal(network.isOffline(), false);
  assert.equal(network.generation(), before + 1);
  assert.equal(told, 1);
});

test('#3913: a backoff set while offline is void once the connection is back', () => {
  let now = 0;
  const network = new Connectivity();
  const policy = new RefreshPolicy(() => now, 300_000, network);
  network.failed(offlineError());
  policy.failed();
  policy.failed();
  policy.failed();
  now += 1_000;
  assert.equal(policy.shouldRefresh(), false, 'still offline: the backoff holds');
  network.reached();
  assert.equal(policy.shouldRefresh(), true, 'back online: retry at once');
  policy.failed();
  assert.equal(policy.shouldRefresh(), false, 'a failure after the return backs off again');
});

test('#3913: the probe asks only while offline, one at a time', async () => {
  const network = new Connectivity();
  let sent = 0;
  let answer: () => void = () => {};
  const check = probeWhileOffline(network, () => {
    sent++;
    return new Promise<void>((resolve) => {
      answer = () => {
        network.reached();
        resolve();
      };
    });
  });
  await check();
  assert.equal(sent, 0, 'online: nothing sent');
  network.failed(offlineError());
  const first = check();
  void check();
  assert.equal(sent, 1, 'never two at once');
  answer();
  await first;
  assert.equal(network.isOffline(), false);
  await check();
  assert.equal(sent, 1);
});

test('#3913: a request whose fetch never settles still fails at its timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // expo/fetch on Android can leave an aborted request pending forever; this one ignores the signal.
  const client = createApiClient('https://example.com', async () => 'token', () => new Promise(() => {}));
  const request = client.get('/api/exercise-history');
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(15_000);
  await assert.rejects(request, (error: Error) => error.name === 'TimeoutError');
  assert.equal(connectivity.isOffline(), true);
  connectivity.reached();
});

test('#3913: offline then online without a restart, the failed view recovers within one retry', async (t) => {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  let offline = true;
  let now = 1_000_000;
  const paths: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (offline) throw offlineError();
    const body = url.pathname === '/api/account/data-epoch' ? { epoch: 0 } : { sets: 3 };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const api = createApiClient('https://example.com', async () => 'token', fetcher);
  const resources = new WorkoutResources(
    storage.account('https://example.com', 'account-one'),
    {
      origin: 'https://example.com',
      userId: 'account-one',
      timezone: null,
      get: api.get,
      post: api.post,
    },
    () => now,
  );
  t.after(() => resources.cancel());
  const spec = { path: '/api/exercise-history', query: { name: 'Squat' }, schema: z.object({ sets: z.number() }) };
  // What WorkoutResourcesProvider does through `onResume`.
  const unsubscribe = connectivity.subscribe(() => void resources.refreshVisible());
  t.after(unsubscribe);

  await resources.load(spec);
  assert.equal(resources.state(spec).data, null);
  assert.match(resources.state(spec).error ?? '', /no connection/);
  assert.equal(connectivity.isOffline(), true);

  // Back online, inside the backoff, with nothing yet asking: the view still shows its failure.
  offline = false;
  now += 1_000;
  const before = paths.length;
  await resources.load(spec);
  assert.equal(paths.length, before, 'the backoff holds until something learns the network is back');

  // The probe's one request answers, and the view reloads by itself.
  const probe = probeWhileOffline(connectivity, () => api.get('/api/account/data-epoch'));
  await probe();
  assert.equal(connectivity.isOffline(), false);
  for (let i = 0; i < 20 && resources.state(spec).data === null; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(resources.state(spec).data, { sets: 3 });
  assert.equal(resources.state(spec).error, null);
  assert.equal(resources.state(spec).loading || resources.state(spec).refreshing, false);
});

test('#3913: Sync now always finishes: a hung step ends in a stated failure, a quick one passes through', async (t) => {
  assert.equal(await withDeadline(Promise.resolve('done'), 45_000, SYNC_NOW_SLOW), 'done');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hung = withDeadline(new Promise(() => {}), 45_000, SYNC_NOW_SLOW);
  t.mock.timers.tick(45_000);
  await assert.rejects(hung, new Error(SYNC_NOW_SLOW));
});
