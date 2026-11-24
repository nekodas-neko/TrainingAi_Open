import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import {
  HISTORY_REQUEST_MS,
  HISTORY_RUN_MS,
  HistoryDownload,
  type HistoryDomain,
} from '../src/core/sync/HistoryDownload.ts';
import { sqliteFixture } from './storage-fixture.ts';

// #3906 review: the header spinner follows `history.status === 'running'`, so a download that
// waits on one request for good would spin for good.
const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
};
async function open(t: { after(fn: () => void): void }, fetch: (key: string) => Promise<unknown>, keys = ['a', 'b', 'c']) {
  const db = sqliteFixture();
  t.after(() => db.connection.close());
  const storage = await createLocalStorage(db.database);
  const domain: HistoryDomain = { id: 'days', label: 'Days', unit: 'day', keys, fetch };
  const account = { origin: 'https://example.com', userId: 'one' };
  const make = () =>
    new HistoryDownload(storage.account(account.origin, account.userId), account, () => [domain], async () => {});
  return { make, download: make() };
}

test('a request that never answers stops the download in a resumable state, and nothing is marked saved', async (t) => {
  const seen: string[] = [];
  let hang = true;
  const { download, make } = await open(t, async (key) => {
    seen.push(key);
    if (key === 'b' && hang) return new Promise(() => {});
  });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  await download.initialize();
  const started = download.start({ anchor: '2026-11-20', days: 3 });
  await flush();
  assert.equal(download.getSnapshot().status, 'running');
  t.mock.timers.tick(HISTORY_REQUEST_MS);
  await started;
  const state = download.getSnapshot();
  assert.equal(state.status, 'failed', 'it leaves running');
  assert.match(state.error ?? '', /got no answer/);
  assert.equal(state.done, 1, 'only "a" is saved; "b" is not claimed');
  assert.equal(state.skipped, 0, 'it is not skipped either: the key stays owed');
  // Resumable, and not from the start: a reopened download carries on at "b".
  hang = false;
  seen.length = 0;
  const reopened = make();
  await reopened.initialize();
  assert.equal(reopened.getSnapshot().status, 'failed');
  await reopened.resume();
  assert.deepEqual(seen, ['b', 'c'], 'the saved key is not read again');
  assert.equal(reopened.getSnapshot().status, 'complete');
});

test('a download that runs past its own end pauses, keeps its place, and does not claim to be done', async (t) => {
  const { download } = await open(t, async () => {
    // Each key takes a minute of the (mocked) clock.
    t.mock.timers.setTime(Date.now() + HISTORY_RUN_MS / 2 + 1);
  });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  await download.initialize();
  await download.start({ anchor: '2026-11-20', days: 3 });
  const state = download.getSnapshot();
  assert.equal(state.status, 'failed');
  assert.notEqual(state.status, 'complete');
  assert.ok(state.done >= 1 && state.done < 3, `stopped part-way at ${state.done}`);
  assert.match(state.error ?? '', /carries on from where it stopped/);
});
