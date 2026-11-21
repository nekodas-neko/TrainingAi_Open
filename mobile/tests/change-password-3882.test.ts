import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApiClient, ApiError } from '../src/features/account/api/client.ts';
import {
  PASSWORD_PATH,
  passwordBody,
  passwordFailure,
  passwordFormProblem,
} from '../src/features/account/data/change-password.ts';

const ok = { current: 'old-pass-1', next: 'new-pass-22', confirm: 'new-pass-22' };

test('the form is checked the way the server checks it, before anything is sent', () => {
  assert.equal(passwordFormProblem(ok), null);
  assert.ok(passwordFormProblem({ ...ok, current: '' }), 'the current password is required');
  assert.ok(passwordFormProblem({ ...ok, next: 'short', confirm: 'short' }), 'under 8 characters');
  assert.ok(passwordFormProblem({ ...ok, confirm: 'new-pass-23' }), 'the two new passwords differ');
  assert.ok(passwordFormProblem({ ...ok, next: 'old-pass-1', confirm: 'old-pass-1' }), 'same as current');
  const long = 'é'.repeat(37); // 37 characters, 74 UTF-8 bytes: over bcrypt's 72
  assert.ok(passwordFormProblem({ ...ok, next: long, confirm: long }), 'over 72 bytes');
  const edge = 'a'.repeat(72);
  assert.equal(passwordFormProblem({ ...ok, next: edge, confirm: edge }), null, '72 bytes is allowed');
  assert.ok(passwordFormProblem({ ...ok, next: 'a'.repeat(201), confirm: 'a'.repeat(201) }));
});

test('the problem text never repeats a password', () => {
  for (const form of [
    { current: 'secret-current', next: 'secret-new-1', confirm: 'other-new-12' },
    { current: 'secret-current', next: 'x', confirm: 'x' },
    { current: 'same-pass-12', next: 'same-pass-12', confirm: 'same-pass-12' },
  ]) {
    const text = passwordFormProblem(form) ?? '';
    for (const value of Object.values(form)) assert.equal(text.includes(value), false);
  }
});

test('the request is PATCH /api/user/password with exactly currentPassword and newPassword', async () => {
  assert.equal(PASSWORD_PATH, '/api/user/password');
  assert.deepEqual(passwordBody(ok), { currentPassword: 'old-pass-1', newPassword: 'new-pass-22' });
  const sent: { url: string; init: RequestInit }[] = [];
  const api = createApiClient(
    'https://example.test',
    async () => 'token',
    (async (url: URL, init: RequestInit) => {
      sent.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
  await api.patch(PASSWORD_PATH, passwordBody(ok));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://example.test/api/user/password');
  assert.equal(sent[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(sent[0].init.body as string), {
    currentPassword: 'old-pass-1',
    newPassword: 'new-pass-22',
  });
});

test('a wrong current password shows the server’s own sentence', async () => {
  const api = createApiClient(
    'https://example.test',
    async () => 'token',
    (async () =>
      new Response(JSON.stringify({ error: 'Current password is incorrect.' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  );
  const failure = await api.patch(PASSWORD_PATH, passwordBody(ok)).catch((error: unknown) => error);
  assert.ok(failure instanceof ApiError);
  assert.equal(passwordFailure(failure), 'Current password is incorrect.');
  assert.equal(failure.message.includes('incorrect'), false, 'the reported message stays generic');
});

test('a limit or an outage gets a fixed line, not a guess', () => {
  assert.match(passwordFailure(new ApiError(429, undefined, undefined, PASSWORD_PATH, true, 'Too many requests')), /Too many attempts/);
  assert.match(passwordFailure(new Error('network')), /Could not change the password/);
  assert.match(passwordFailure(new ApiError(500, undefined, undefined, PASSWORD_PATH, false)), /Could not change the password/);
});

test('the sheet clears its fields after every answer and never logs or stores the password', () => {
  const source = readFileSync(
    new URL('../src/features/account/components/ChangePasswordSheet.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /finally \{[^}]*setForm\(emptyPasswordForm\)/s);
  assert.match(source, /secureTextEntry/);
  assert.doesNotMatch(source, /console\.|storage|AsyncStorage|SecureStore|reportError/);
});
