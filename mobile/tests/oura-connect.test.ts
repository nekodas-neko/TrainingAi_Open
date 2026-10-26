import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/features/account/api/client.ts';
import type { AccountConnection } from '../src/features/account/session.ts';
import { createRequire } from 'node:module';
import {
  COLD_START_MAX_AGE_MS,
  OuraReturns,
  RETURN_GRACE_MS,
  connectOura,
  connectStartedRecently,
  disconnectOura,
  finishOuraCallback,
  ouraCallback,
  ouraMessage,
  parseOuraCallback,
  readOuraStatus,
} from '../src/features/devices/data/oura.ts';

const require = createRequire(import.meta.url);
const visibility = require('../src/integrations/oura/oura-package-visibility.cjs') as {
  addPackageQuery: (manifest: Manifest, name: string) => Manifest;
  OURA_PACKAGE: string;
};
type Manifest = {
  manifest: { queries?: { package?: { $: Record<string, string> }[]; intent?: unknown[] }[] };
};

const BACK = 'com.trainingai.app.preview:/oura/callback';
function connection(answers: Record<string, unknown>, calls: string[] = []): AccountConnection {
  const answer = async (key: string) => {
    calls.push(key);
    const value = answers[key];
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    origin: 'https://example.com',
    userId: 'u1',
    timezone: null,
    get: (path) => answer(`GET ${path}`),
    post: (path, body) => answer(`POST ${path} ${JSON.stringify(body)}`),
    delete: (path) => answer(`DELETE ${path}`),
  };
}

test('the return address is this build\'s scheme with the Oura path', () => {
  assert.equal(ouraCallback('android-preview'), BACK);
  assert.equal(ouraCallback('android'), 'com.trainingai.app:/oura/callback');
  assert.equal(ouraCallback('ios'), 'com.fitnessai.training:/oura/callback');
});

test('parses pending, connected and error returns, and ignores anything else', () => {
  assert.deepEqual(parseOuraCallback(`${BACK}?oura=pending&handle=h.1`, 'android-preview'), { kind: 'pending', handle: 'h.1' });
  assert.deepEqual(parseOuraCallback(`${BACK}?oura=connected`, 'android-preview'), { kind: 'connected' });
  assert.deepEqual(parseOuraCallback(`${BACK}?oura=error&reason=in_use`, 'android-preview'), { kind: 'error', reason: 'in_use' });
  assert.deepEqual(parseOuraCallback(`${BACK}?oura=pending`, 'android-preview'), { kind: 'error', reason: 'failed' });
  assert.equal(parseOuraCallback('com.trainingai.app.preview:/auth/callback?code=x', 'android-preview'), null);
  assert.equal(parseOuraCallback(`com.trainingai.app:/oura/callback?oura=connected`, 'android-preview'), null);
  assert.equal(parseOuraCallback(`${BACK}-evil?oura=connected`, 'android-preview'), null);
});

test('connect posts this build\'s client, opens Oura and completes the pending grant with the bearer', async () => {
  const calls: string[] = [];
  const conn = connection({
    'POST /api/oura/connect {"client":"android-preview"}': { url: 'https://example.com/api/oura/connect?ticket=t' },
    'POST /api/oura/connect/complete {"handle":"h.1"}': { connected: true },
  }, calls);
  const opened: string[] = [];
  const result = await connectOura(conn, 'android-preview', async (url, redirect) => {
    opened.push(url, redirect);
    return { type: 'success', url: `${BACK}?oura=pending&handle=h.1` };
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(opened, ['https://example.com/api/oura/connect?ticket=t', BACK]);
  assert.deepEqual(calls, [
    'POST /api/oura/connect {"client":"android-preview"}',
    'POST /api/oura/connect/complete {"handle":"h.1"}',
  ]);
});

test('a closed browser is a cancel, not an error', async () => {
  const conn = connection({ 'POST /api/oura/connect {"client":"android"}': { url: 'https://example.com/x' } });
  const result = await connectOura(conn, 'android', async () => ({ type: 'cancel' }));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.cancelled, true);
});

test('shows the real reason for each refusal', async () => {
  const start = (error: Error) =>
    connectOura(connection({ 'POST /api/oura/connect {"client":"android"}': error }), 'android', async () => ({ type: 'cancel' }));
  const notConfigured = await start(new ApiError(503));
  assert.match(!notConfigured.ok ? notConfigured.message : '', /not set up on the server/);
  assert.match(ouraMessage(new ApiError(409)), /already connected to another TrainingAi account/);
  assert.match(ouraMessage(new ApiError(410)), /expired/);
  assert.match(ouraMessage(new ApiError(429)), /Too many attempts/);
  assert.match(ouraMessage(new ApiError(401)), /Sign in again/);
  assert.match(ouraMessage('denied'), /not allowed/);
  assert.match(ouraMessage('expired'), /timed out/);
  assert.match(ouraMessage('in_use'), /another TrainingAi account/);
  assert.match(ouraMessage('signed_out'), /Sign in again/);
  assert.match(ouraMessage('something-new'), /could not finish/);
  assert.match(ouraMessage(new TypeError('Network request failed')), /could not be reached/);
});

test('a pending grant the server refuses reports why', async () => {
  for (const [status, pattern] of [[409, /another TrainingAi account/], [410, /expired/], [403, /different account/]] as const) {
    const conn = connection({ 'POST /api/oura/connect/complete {"handle":"h"}': new ApiError(status) });
    const result = await finishOuraCallback(conn, { kind: 'pending', handle: 'h' });
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : '', pattern);
  }
  const error = await finishOuraCallback(connection({}), { kind: 'error', reason: 'denied' });
  assert.match(!error.ok ? error.message : '', /not allowed/);
});

test('status is parsed strictly, and disconnect calls DELETE', async () => {
  const calls: string[] = [];
  const conn = connection({
    'GET /api/oura/connection': { connected: true, scope: 'daily', expiresAt: '2026-10-15T00:00:00Z' },
    'DELETE /api/oura/connection': { disconnected: true, revoked: true },
  }, calls);
  assert.deepEqual(await readOuraStatus(conn), { connected: true, scope: 'daily', expiresAt: '2026-10-15T00:00:00Z' });
  await assert.rejects(readOuraStatus(connection({ 'GET /api/oura/connection': { connected: 'yes' } })));
  // #2861: when the feed last spoke comes through, and a server without the stamps still parses.
  assert.deepEqual(
    await readOuraStatus(connection({ 'GET /api/oura/connection': { connected: true, scope: 'daily', expiresAt: null, lastDataAt: '2026-10-26T01:05:00.000Z', lastWebhookAt: null } })),
    { connected: true, scope: 'daily', expiresAt: null, lastDataAt: '2026-10-26T01:05:00.000Z', lastWebhookAt: null },
  );
  // #3227: a grant Oura refused comes back not connected, with a field the schema drops.
  assert.deepEqual(
    await readOuraStatus(connection({ 'GET /api/oura/connection': { connected: false, scope: null, expiresAt: null, reauthRequired: true } })),
    { connected: false, scope: null, expiresAt: null },
  );
  assert.deepEqual(await disconnectOura(conn), { ok: true });
  assert.deepEqual(calls, ['GET /api/oura/connection', 'DELETE /api/oura/connection']);
  const refused = await disconnectOura(connection({ 'DELETE /api/oura/connection': new ApiError(503) }));
  assert.match(!refused.ok ? refused.message : '', /not set up on the server/);
});

const START = 'POST /api/oura/connect {"client":"android-preview"}';
const COMPLETE = 'POST /api/oura/connect/complete {"handle":"h.1"}';
const RETURN = `${BACK}?oura=pending&handle=h.1`;

test('on Android the screen\'s link listener and the browser share one /complete call', async () => {
  const calls: string[] = [];
  const conn = connection({ [START]: { url: 'https://example.com/x' }, [COMPLETE]: { connected: true } }, calls);
  const returns = new OuraReturns();
  let fromListener: Promise<unknown> | null = null;
  const result = await connectOura(conn, 'android-preview', async () => {
    // The screen's listener was registered first, so it receives the return before the browser resolves.
    fromListener = returns.finish(RETURN, 'android-preview', conn);
    assert.ok(fromListener, 'the listener accepts a return while a connect is open');
    return { type: 'success', url: RETURN };
  }, returns);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(await fromListener, { ok: true });
  // And a late duplicate of the same link still does not post again.
  assert.deepEqual(await returns.finish(RETURN, 'android-preview', conn), { ok: true });
  assert.deepEqual(calls.filter((call) => call === COMPLETE), [COMPLETE]);
});

test('a return the browser reported as closed is still finished if the link lands just after', async () => {
  let now = 1_000_000;
  const calls: string[] = [];
  const conn = connection({ [START]: { url: 'https://example.com/x' }, [COMPLETE]: { connected: true } }, calls);
  const returns = new OuraReturns(() => now);
  const result = await connectOura(conn, 'android-preview', async () => ({ type: 'dismiss' }), returns);
  assert.equal(!result.ok && result.cancelled, true);
  now += RETURN_GRACE_MS - 1;
  assert.deepEqual(await returns.finish(RETURN, 'android-preview', conn), { ok: true });
  assert.deepEqual(calls, [START, COMPLETE]);
});

test('an Oura link is ignored unless this phone is waiting for one', async () => {
  let now = 1_000_000;
  const calls: string[] = [];
  const conn = connection({ [COMPLETE]: { connected: true } }, calls);
  const returns = new OuraReturns(() => now);
  assert.equal(returns.finish(RETURN, 'android-preview', conn), null);
  returns.begin();
  returns.end();
  now += RETURN_GRACE_MS + 1;
  assert.equal(returns.finish(RETURN, 'android-preview', conn), null);
  assert.equal(returns.finish('com.trainingai.app.preview:/auth/callback?x=1', 'android-preview', conn), null);
  assert.deepEqual(calls, []);
});

test('a cold-start return is finished once, and only after a connect this phone started recently', async () => {
  const calls: string[] = [];
  const conn = connection({ [COMPLETE]: { connected: true } }, calls);
  const returns = new OuraReturns();
  const first = returns.finish(RETURN, 'android-preview', conn, { coldStart: true });
  const second = returns.finish(RETURN, 'android-preview', conn, { coldStart: true });
  assert.equal(first, second);
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(calls, [COMPLETE]);

  const now = 50_000_000;
  assert.equal(connectStartedRecently(String(now - 60_000), now), true);
  assert.equal(connectStartedRecently(String(now - COLD_START_MAX_AGE_MS - 1), now), false);
  assert.equal(connectStartedRecently(String(now + 60_000), now), false);
  assert.equal(connectStartedRecently(null, now), false);
  assert.equal(connectStartedRecently('soon', now), false);
});

test('a reason that names an Object.prototype key falls back to the generic message', async () => {
  for (const reason of ['__proto__', 'constructor', 'hasOwnProperty', 'toString']) {
    assert.match(ouraMessage(reason), /could not finish/);
    const parsed = parseOuraCallback(`${BACK}?oura=error&reason=${reason}`, 'android-preview');
    assert.ok(parsed);
    const result = await finishOuraCallback(connection({}), parsed);
    assert.match(!result.ok ? result.message : '', /could not finish/);
  }
  const unknown = new ApiError(418);
  assert.match(ouraMessage(unknown), /could not finish/);
});

test('the Android manifest names Oura in <queries> exactly once, however often it is applied', () => {
  const name = visibility.OURA_PACKAGE;
  assert.equal(name, 'com.ouraring.oura');
  const entries = (manifest: Manifest) =>
    (manifest.manifest.queries ?? []).flatMap((query) => query.package ?? []).filter((entry) => entry.$['android:name'] === name);

  const empty: Manifest = { manifest: {} };
  visibility.addPackageQuery(empty, name);
  visibility.addPackageQuery(empty, name);
  assert.equal(entries(empty).length, 1);

  const alreadyListed: Manifest = {
    manifest: { queries: [{ intent: [{}] }, { package: [{ $: { 'android:name': name } }] }] },
  };
  visibility.addPackageQuery(alreadyListed, name);
  assert.equal(entries(alreadyListed).length, 1);

  const others: Manifest = {
    manifest: { queries: [{ package: [{ $: { 'android:name': 'com.android.settings' } }] }] },
  };
  visibility.addPackageQuery(others, name);
  assert.equal(entries(others).length, 1);
  assert.equal(others.manifest.queries?.[0].package?.length, 2);
});
