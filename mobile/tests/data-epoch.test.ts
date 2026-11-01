// #3369 — Preview honours an admin reset: it wipes every store of the account (queued writes
// included) before the account's stores can open, wipes a previous account's data when someone
// else signs in, and sends the epoch it has wiped for on every write.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccountSession } from '../src/features/account/session.ts';
import type { AuthPlatform } from '../src/features/account/session.ts';
import { createApiClient } from '../src/features/account/api/client.ts';
import {
  DEVICE_RECORD_KEY,
  epochHeader,
  parseDeviceRecord,
  reconcileDevice,
} from '../src/features/account/device-record.ts';

const origin = 'https://example.com';
const SESSION_KEY = 'fitnessai.session.v1';
const now = () => Math.floor(Date.now() / 1000);
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const record = (userId: string, epoch: number) => JSON.stringify({ origin, userId, epoch });

test('reconcileDevice: a phone that has seen the reset is left alone', async () => {
  const wipes: unknown[] = [];
  const disk = { value: record('u1', 500) as string | null };
  const out = await reconcileDevice(
    { read: async () => disk.value, write: async (v) => void (disk.value = v), wipe: async (o, u) => void wipes.push([o, u]) },
    origin, 'u1', 500,
  );
  assert.equal(out.outcome, 'ok');
  assert.deepEqual(wipes, []);
});

test('reconcileDevice: behind a reset, the account scope is wiped, then the epoch is recorded', async () => {
  const order: string[] = [];
  const disk = { value: record('u1', 100) as string | null };
  const out = await reconcileDevice(
    {
      read: async () => disk.value,
      write: async (v) => { order.push('write'); disk.value = v; },
      wipe: async (o, u) => void order.push(`wipe:${u}`),
    },
    origin, 'u1', 900,
  );
  assert.equal(out.outcome, 'wiped');
  assert.deepEqual(order, ['wipe:u1', 'write']);
  assert.equal(parseDeviceRecord(disk.value)?.epoch, 900);
});

test('reconcileDevice: another account signing in wipes every account scope (delete, then re-signup)', async () => {
  const wipes: unknown[] = [];
  const disk = { value: record('old', 0) as string | null };
  const out = await reconcileDevice(
    { read: async () => disk.value, write: async (v) => void (disk.value = v), wipe: async (o, u) => void wipes.push(u) },
    origin, 'new', 0,
  );
  assert.equal(out.outcome, 'wiped');
  assert.deepEqual(wipes, [null]);
  assert.equal(parseDeviceRecord(disk.value)?.userId, 'new');
});

test('reconcileDevice: a phone with no record adopts an account that was never reset, and wipes one that was', async () => {
  const wipes: unknown[] = [];
  const mk = () => ({ value: null as string | null });
  let disk = mk();
  const deps = () => ({ read: async () => disk.value, write: async (v: string) => void (disk.value = v), wipe: async (_o: string, u: string | null) => void wipes.push(u) });
  assert.equal((await reconcileDevice(deps(), origin, 'u1', 0)).outcome, 'ok');
  assert.deepEqual(wipes, []);
  disk = mk();
  assert.equal((await reconcileDevice(deps(), origin, 'u1', 700)).outcome, 'wiped');
  assert.deepEqual(wipes, ['u1']);
});

test('reconcileDevice: a failed wipe records nothing, so the next attempt wipes again', async () => {
  const disk = { value: record('u1', 1) as string | null };
  await assert.rejects(
    reconcileDevice(
      { read: async () => disk.value, write: async (v) => void (disk.value = v), wipe: async () => { throw new Error('locked'); } },
      origin, 'u1', 9,
    ),
  );
  assert.equal(parseDeviceRecord(disk.value)?.epoch, 1);
});

test('epochHeader names the epoch only for the recorded account on this backend', () => {
  const r = { origin, userId: 'u1', epoch: 42 };
  assert.equal(epochHeader(r, origin, 'u1'), 'u1:42');
  assert.equal(epochHeader(r, origin, 'u2'), null);
  assert.equal(epochHeader(r, 'https://other.example', 'u1'), null);
  assert.equal(epochHeader(null, origin, 'u1'), null);
});

test('the API client sends X-Data-Epoch on writes only, and reports a 409 data-epoch-stale', async (t) => {
  const seen: { method: string; header: string | null }[] = [];
  let stale = 0;
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    seen.push({ method, header: new Headers(init?.headers).get('x-data-epoch') });
    return method === 'POST'
      ? json({ error: 'data-epoch-stale', epoch: 5 }, 409, { 'x-data-epoch-stale': '1' })
      : json({ ok: true });
  }) as typeof fetch;
  const api = createApiClient(origin, async () => 'tok', fetcher, undefined, {
    dataEpoch: () => 'u1:5',
    onDataEpochStale: () => { stale += 1; },
  });
  await api.get('/api/x');
  await assert.rejects(api.post('/api/sync/push', { a: 1 }));
  assert.deepEqual(seen, [{ method: 'GET', header: null }, { method: 'POST', header: 'u1:5' }]);
  assert.equal(stale, 1);
  t.diagnostic('a 409 is still an error for the caller, which keeps its queued write until the wipe');
});

function sessionFixture(opts: { saved?: Record<string, unknown> | null; deviceRecord?: string | null; serverEpoch: number }) {
  const storage = new Map<string, string>();
  if (opts.saved) storage.set(SESSION_KEY, JSON.stringify({ origin, ...opts.saved }));
  if (opts.deviceRecord) storage.set(DEVICE_RECORD_KEY, opts.deviceRecord);
  const wipes: (string | null)[] = [];
  const writes: { path: string; header: string | null }[] = [];
  let epoch = opts.serverEpoch;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET';
    if (method !== 'GET') writes.push({ path, header: new Headers(init?.headers).get('x-data-epoch') });
    if (path === '/api/user/profile') return json({ user: { id: 'u1', email: 'me@example.com', name: 'Sam', timezone: null, isActive: true }, signInProviders: ['google'] });
    if (path === '/api/account/data-epoch') return json({ epoch });
    return json({ ok: true });
  }) as typeof fetch;
  const platform: AuthPlatform = {
    fetch: fetcher,
    get: async (k) => storage.get(k) ?? null,
    set: async (k, v) => void storage.set(k, v),
    remove: async (k) => void storage.delete(k),
    random: async () => 'S'.repeat(43),
    challenge: async () => 'S'.repeat(43),
    open: async () => ({ type: 'cancel' }),
    dismiss() {},
    wipeAccountData: async (_o, u) => void wipes.push(u),
  };
  return { controller: new AccountSession(origin, platform), storage, wipes, writes, setEpoch: (n: number) => void (epoch = n) };
}

test('a fresh sign-in after a reset wipes the account before its stores can open', async () => {
  // A saved session with no user id yet is a sign-in that has just completed.
  const fx = sessionFixture({ saved: { accessToken: 'tok', expiresAt: now() + 86_000, userId: null }, deviceRecord: record('u1', 100), serverEpoch: 900 });
  let readerDuringWipe: unknown = 'unset';
  const base = fx.controller as unknown as { platform: AuthPlatform };
  const original = base.platform.wipeAccountData!;
  base.platform.wipeAccountData = async (o, u) => { readerDuringWipe = fx.controller.dataReader; await original(o, u); };
  await fx.controller.initialize(null);
  assert.deepEqual(fx.wipes, ['u1']);
  assert.equal(readerDuringWipe, null, 'no store can open while the wipe runs');
  assert.equal(fx.controller.state.status, 'signedIn');
  assert.ok(fx.controller.dataReader, 'the account opens afterwards');
  assert.equal(parseDeviceRecord(fx.storage.get(DEVICE_RECORD_KEY) ?? null)?.epoch, 900);
});

test('a saved session found at launch on a phone behind a reset is signed out after the wipe', async () => {
  const f = sessionFixture({ saved: { accessToken: 'tok', expiresAt: now() + 86_000, userId: 'u1' }, deviceRecord: record('u1', 100), serverEpoch: 900 });
  await f.controller.initialize(null);
  assert.deepEqual(f.wipes, ['u1']);
  assert.equal(f.controller.state.status, 'signedOut');
  assert.match(f.controller.state.message ?? '', /reset/i);
  assert.equal(f.controller.dataReader, null);
});

test('a phone that has seen the reset opens normally and writes carry its epoch', async () => {
  const f = sessionFixture({ saved: { accessToken: 'tok', expiresAt: now() + 86_000, userId: 'u1' }, deviceRecord: record('u1', 900), serverEpoch: 900 });
  await f.controller.initialize(null);
  assert.deepEqual(f.wipes, []);
  assert.equal(f.controller.state.status, 'signedIn');
  await f.controller.dataReader!.post('/api/sync/push', { mutations: [] });
  assert.deepEqual(f.writes.at(-1), { path: '/api/sync/push', header: 'u1:900' });
});

test('someone else signing in on a phone holding another account wipes every account scope', async () => {
  const f = sessionFixture({ saved: { accessToken: 'tok', expiresAt: now() + 86_000, userId: null }, deviceRecord: record('old-user', 0), serverEpoch: 0 });
  await f.controller.initialize(null);
  assert.deepEqual(f.wipes, [null]);
  assert.equal(f.controller.state.status, 'signedIn');
});

test('a refused write (409) on a phone that is behind wipes it and signs out', async () => {
  const f = sessionFixture({ saved: { accessToken: 'tok', expiresAt: now() + 86_000, userId: 'u1' }, deviceRecord: record('u1', 0), serverEpoch: 0 });
  await f.controller.initialize(null);
  assert.equal(f.controller.state.status, 'signedIn');
  f.setEpoch(900);   // an admin resets the account while the phone is signed in
  const stale = (f.controller as unknown as { dataEpochStale(): Promise<void> }).dataEpochStale();
  await stale;
  assert.deepEqual(f.wipes, ['u1']);
  assert.equal(f.controller.state.status, 'signedOut');
});

test('reconcileDevice: a phone with no record that holds another account\'s data wipes only the other accounts', async () => {
  const wipes: unknown[] = [];
  const others: unknown[] = [];
  const disk = { value: null as string | null };
  const out = await reconcileDevice(
    {
      read: async () => disk.value,
      write: async (v) => void (disk.value = v),
      wipe: async (_o, u) => void wipes.push(u),
      holdsOtherAccounts: async () => true,
      wipeOthers: async (_o, keep) => void others.push(keep),
    },
    origin, 'new', 0,
  );
  // The signed-in account's own scope and outbox are kept, and the phone is not told to sign out.
  assert.equal(out.outcome, 'ok');
  assert.deepEqual(others, ['new']);
  assert.deepEqual(wipes, []);
  assert.equal(parseDeviceRecord(disk.value)?.userId, 'new');
});

test('reconcileDevice: other accounts plus a reset wipes the others, then the account that is behind', async () => {
  const order: string[] = [];
  const disk = { value: null as string | null };
  const out = await reconcileDevice(
    {
      read: async () => disk.value,
      write: async (v) => { order.push('write'); disk.value = v; },
      wipe: async (_o, u) => void order.push(`wipe:${u}`),
      holdsOtherAccounts: async () => true,
      wipeOthers: async (_o, keep) => void order.push(`others-except:${keep}`),
    },
    origin, 'new', 700,
  );
  assert.equal(out.outcome, 'wiped');
  assert.deepEqual(order, ['others-except:new', 'wipe:new', 'write']);
});

test('reconcileDevice: other accounts without a way to spare this one is refused, not wiped wholesale', async () => {
  const wipes: unknown[] = [];
  const disk = { value: null as string | null };
  await assert.rejects(
    reconcileDevice(
      {
        read: async () => disk.value,
        write: async (v) => void (disk.value = v),
        wipe: async (_o, u) => void wipes.push(u),
        holdsOtherAccounts: async () => true,
      },
      origin, 'new', 0,
    ),
  );
  assert.deepEqual(wipes, []);
  assert.equal(disk.value, null);
});

test('reconcileDevice: a failed wipe of the other accounts records nothing', async () => {
  const disk = { value: null as string | null };
  await assert.rejects(
    reconcileDevice(
      {
        read: async () => disk.value,
        write: async (v) => void (disk.value = v),
        wipe: async () => {},
        holdsOtherAccounts: async () => true,
        wipeOthers: async () => { throw new Error('locked'); },
      },
      origin, 'new', 0,
    ),
  );
  assert.equal(disk.value, null);
});

test('a recordless Preview phone holding a second account keeps the signed-in account signed in with its scope untouched', async () => {
  const f = sessionFixture({ saved: { accessToken: 'tok', expiresAt: now() + 86_000, userId: 'u1' }, deviceRecord: null, serverEpoch: 0 });
  const calls: string[] = [];
  const base = f.controller as unknown as { platform: AuthPlatform };
  base.platform.holdsOtherAccountData = async () => true;
  base.platform.wipeOtherAccountData = async (_o, keep) => void calls.push(`others-except:${keep}`);
  await f.controller.initialize(null);
  assert.deepEqual(calls, ['others-except:u1']);
  assert.deepEqual(f.wipes, [], 'the signed-in account\'s scope is not wiped');
  assert.equal(f.controller.state.status, 'signedIn', 'and the person is not signed out');
  assert.ok(f.controller.dataReader);
  assert.equal(parseDeviceRecord(f.storage.get(DEVICE_RECORD_KEY) ?? null)?.userId, 'u1');
});

test('reconcileDevice: a phone with no record and no other account\'s data is simply claimed', async () => {
  const wipes: unknown[] = [];
  const disk = { value: null as string | null };
  const out = await reconcileDevice(
    {
      read: async () => disk.value,
      write: async (v) => void (disk.value = v),
      wipe: async (_o, u) => void wipes.push(u),
      holdsOtherAccounts: async () => false,
    },
    origin, 'new', 0,
  );
  assert.equal(out.outcome, 'ok');
  assert.deepEqual(wipes, []);
});

test('reconcileDevice: if the other-account check fails nothing is claimed or recorded', async () => {
  const disk = { value: null as string | null };
  await assert.rejects(
    reconcileDevice(
      {
        read: async () => disk.value,
        write: async (v) => void (disk.value = v),
        wipe: async () => {},
        holdsOtherAccounts: async () => { throw new Error('locked'); },
      },
      origin, 'new', 0,
    ),
  );
  assert.equal(disk.value, null);
});

test('reconcileDevice: an empty user id is refused before anything is read, wiped or recorded', async () => {
  const touched: string[] = [];
  await assert.rejects(
    reconcileDevice(
      {
        read: async () => { touched.push('read'); return null; },
        write: async () => void touched.push('write'),
        wipe: async () => void touched.push('wipe'),
      },
      origin, '', 0,
    ),
  );
  assert.deepEqual(touched, []);
});

test('reconcileDevice: a new owner resets the device-scoped battery alert; the same owner behind a reset does not (#3435)', async () => {
  const run = async (record: string | null, userId: string, serverEpoch: number, others = false) => {
    const calls: string[] = [];
    await reconcileDevice(
      {
        read: async () => record,
        write: async () => {},
        wipe: async () => void calls.push('wipe'),
        holdsOtherAccounts: async () => others,
        wipeOthers: async () => void calls.push('wipe-others'),
        ownerChanged: async () => void calls.push('owner-changed'),
      },
      origin, userId, serverEpoch,
    );
    return calls;
  };
  const recorded = JSON.stringify({ origin, userId: 'u1', epoch: 0 });
  assert.deepEqual(await run(recorded, 'u2', 0), ['wipe', 'owner-changed']);
  assert.deepEqual(await run(null, 'u2', 0, true), ['wipe-others', 'owner-changed']);
  assert.deepEqual(await run(recorded, 'u1', 3), ['wipe'], 'same person: their own alert state stands');
  assert.deepEqual(await run(recorded, 'u1', 0), []);
  assert.deepEqual(await run(null, 'u2', 0), [], 'a claimed empty phone has no previous owner');
});

test('reconcileDevice: a failure resetting the battery alert never blocks the sign-in', async () => {
  const disk = { value: JSON.stringify({ origin, userId: 'u1', epoch: 0 }) as string | null };
  const out = await reconcileDevice(
    {
      read: async () => disk.value,
      write: async (v) => void (disk.value = v),
      wipe: async () => {},
      ownerChanged: async () => { throw new Error('locked'); },
    },
    origin, 'u2', 0,
  );
  assert.equal(out.outcome, 'wiped');
  assert.equal(parseDeviceRecord(disk.value)?.userId, 'u2');
});
