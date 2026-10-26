import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  actionFailure,
  emailMatches,
  performWipe,
  wipeActions,
  wipeConfirm,
  wipeFailure,
  wipeRequest,
  inviteEmail,
  partitionUsers,
  userActionConfirm,
  userActions,
  type AdminUser,
} from '../src/features/admin/data/admin-users.ts';

const user = (over: Partial<AdminUser>): AdminUser => ({
  id: 'u',
  email: 'a@b.co',
  isActive: true,
  ...over,
});

test('pending is an inactive user with no data; an unknown hasData is never offered the trash', () => {
  const { pending, deactivated, active } = partitionUsers([
    user({ id: '1', isActive: false, hasData: false }),
    user({ id: '2', isActive: false, hasData: true }),
    user({ id: '3', isActive: false }),
    user({ id: '4' }),
  ]);
  assert.deepEqual(pending.map((u) => u.id), ['1']);
  assert.deepEqual(deactivated.map((u) => u.id), ['2', '3']);
  assert.deepEqual(active.map((u) => u.id), ['4']);
  assert.ok(!userActions(user({ isActive: false }), false).includes('delete'));
});

test('row actions: your own row never offers deactivate, delete or remove-admin', () => {
  assert.deepEqual(userActions(user({ isAdmin: true }), true), []);
  assert.deepEqual(userActions(user({ isAdmin: true }), false), ['deactivate', 'revoke-admin']);
  assert.deepEqual(userActions(user({}), false), ['deactivate', 'grant-admin']);
  assert.deepEqual(userActions(user({ isActive: false, hasData: false }), false), ['activate', 'delete']);
  assert.deepEqual(userActions(user({ isActive: false, hasData: true }), false), ['activate']);
});

test('only activation skips the confirm, as in the current app', () => {
  assert.equal(userActionConfirm('activate', user({})), null);
  for (const action of ['deactivate', 'delete', 'grant-admin', 'revoke-admin'] as const)
    assert.ok(userActionConfirm(action, user({ displayName: 'Sam' }))?.message.includes('Sam'), action);
});

test('confirm copy matches the current app word for word', () => {
  const web = readFileSync(new URL('../../app/admin/admin-content.tsx', import.meta.url), 'utf8');
  for (const action of ['deactivate', 'delete', 'grant-admin', 'revoke-admin'] as const) {
    const c = userActionConfirm(action, user({}))!;
    assert.ok(web.includes(`title="${c.title}"`) || web.includes(`'${c.title}'`), c.title);
    assert.ok(web.includes(c.confirmLabel), c.confirmLabel);
  }
  assert.ok(web.includes('Remove invite?'));
});

test('failures read in plain words from the status', () => {
  assert.match(actionFailure('delete', { status: 409 }), /has data/);
  assert.equal(actionFailure('activate', { status: 404 }), 'User not found');
  assert.match(actionFailure('revoke-admin', { status: 400 }), /your own admin/);
  assert.equal(actionFailure('activate', new Error('x')), 'Action failed');
});

test('invites are stored trimmed and lower-case', () => {
  assert.equal(inviteEmail('  Foo@Bar.com '), 'foo@bar.com');
});

test('wipe confirm unlocks only on the row\'s email, ignoring case and spaces', () => {
  assert.equal(emailMatches('', 'a@b.co'), false);
  assert.equal(emailMatches('a@b.c', 'a@b.co'), false);
  assert.equal(emailMatches(' A@B.CO ', 'a@b.co'), true);
  assert.equal(emailMatches('', ''), false);
  assert.match(readFileSync(new URL('../src/features/admin/components/ConfirmSheet.tsx', import.meta.url), 'utf8'), /disabled=\{locked\}/);
});

test('wipe titles and labels are the web console\'s', () => {
  const r = wipeConfirm('reset', user({}), false);
  assert.deepEqual([r.title, r.confirmLabel], ['Reset data?', 'Reset data']);
  const e = wipeConfirm('erase', user({}), false);
  assert.deepEqual([e.title, e.confirmLabel], ['Delete account and data?', 'Delete account']);
  assert.match(wipeConfirm('reset', user({}), true).message, /signed out now/);
});

test('wipe buttons follow the web console: no other admin, no signup that never got in', () => {
  assert.deepEqual(wipeActions(user({}), false), ['reset', 'erase']);
  assert.deepEqual(wipeActions(user({ isAdmin: true }), false), []);
  assert.deepEqual(wipeActions(user({ isAdmin: true }), true), ['reset']);
  assert.deepEqual(wipeActions(user({}), true), ['reset']);
  assert.deepEqual(wipeActions(user({ isActive: false, hasData: false }), false), []);
});

test('the right route and body are sent, with the typed email', () => {
  const u = user({ id: 'u1', email: 'a@b.co' });
  assert.deepEqual(wipeRequest('reset', u, 'A@B.co'), {
    method: 'POST',
    path: '/api/admin/users/reset-data',
    body: { userId: 'u1', confirmEmail: 'A@B.co' },
  });
  assert.deepEqual(wipeRequest('erase', u, 'a@b.co'), {
    method: 'DELETE',
    path: '/api/admin/users',
    body: { userId: 'u1', confirmEmail: 'a@b.co' },
  });
});

test('each refusal reads as a sentence and never shows the response text', () => {
  for (const kind of ['reset', 'erase'] as const) {
    const said = new Set<string>();
    for (const status of [403, 409, 429, 404]) {
      const text = wipeFailure(kind, Object.assign(new Error('SECRET body text'), { status }));
      assert.ok(!text.includes('SECRET'));
      said.add(text);
    }
    assert.equal(said.size, 4);
  }
  assert.match(wipeFailure('reset', { status: 403 }), /another admin's or the owner's, or the server's owner setting/);
  assert.match(wipeFailure('erase', { status: 429 }), /Too many/);
  assert.match(wipeFailure('erase', { status: 404 }), /no longer exists/);
  assert.match(wipeFailure('reset', { status: 500 }), /could not be reset\. Nothing was removed/);
  // A timeout or gateway error may have committed on the server: never claim nothing was removed.
  for (const failure of [new Error('aborted'), { status: 502 }, { status: 504 }]) {
    const text = wipeFailure('reset', failure);
    assert.match(text, /not known whether anything was removed/);
    assert.ok(!text.includes('Nothing was removed'));
  }
});

test('performWipe: refreshes the lists, signs out only after your own reset', async () => {
  const calls: unknown[][] = [];
  let signOuts = 0;
  const io = (response: unknown) => ({
    write: async (...args: unknown[]) => (calls.push(args), response),
    signOut: () => void signOuts++,
  });
  const u = user({ id: 'u1' });
  const other = await performWipe('reset', u, 'a@b.co', io({ ok: true, signedOut: false, defaultsSeeded: true }));
  assert.equal(other.error, false);
  assert.equal(signOuts, 0);
  assert.deepEqual(calls[0].slice(0, 2), ['POST', '/api/admin/users/reset-data']);
  assert.deepEqual(calls[0][3], ['/api/admin/users', '/api/admin/pending-count']);
  const own = await performWipe('reset', u, 'a@b.co', io({ ok: true, signedOut: true }));
  assert.equal(signOuts, 1);
  assert.match(own.text, /Sign in again/);
  await performWipe('erase', u, 'a@b.co', io({ ok: true, signedOut: true }));
  assert.equal(signOuts, 1);
  const failed = await performWipe('erase', u, 'a@b.co', {
    write: async () => { throw Object.assign(new Error('x'), { status: 403 }); },
    signOut: () => void signOuts++,
  });
  assert.equal(failed.error, true);
  assert.equal(signOuts, 1);
});

test('an admin reset or delete gets the long client timeout, so a heavy wipe is not cut off', async (t) => {
  const delays: number[] = [];
  t.mock.method(globalThis, 'setTimeout', ((fn: () => void, ms: number) => {
    delays.push(ms);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  t.mock.method(globalThis, 'fetch', async () =>
    new Response('{}', { headers: { 'content-type': 'application/json' } }));
  const client = createApiClient('https://example.com', async () => 'session');
  await client.post('/api/admin/users/reset-data', { userId: 'u1', confirmEmail: 'a@b.co' });
  await client.delete('/api/admin/users', { userId: 'u1', confirmEmail: 'a@b.co' });
  await client.get('/api/admin/users');
  assert.deepEqual(delays, [130_000, 130_000, 15_000]);
});
