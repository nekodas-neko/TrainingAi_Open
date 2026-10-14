import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/features/account/api/client.ts';
import type { AccountConnection } from '../src/features/account/session.ts';
import {
  connectOura,
  disconnectOura,
  finishOuraCallback,
  ouraCallback,
  ouraMessage,
  parseOuraCallback,
  readOuraStatus,
} from '../src/features/devices/data/oura.ts';

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
  assert.deepEqual(await disconnectOura(conn), { ok: true });
  assert.deepEqual(calls, ['GET /api/oura/connection', 'DELETE /api/oura/connection']);
  const refused = await disconnectOura(connection({ 'DELETE /api/oura/connection': new ApiError(503) }));
  assert.match(!refused.ok ? refused.message : '', /not set up on the server/);
});
