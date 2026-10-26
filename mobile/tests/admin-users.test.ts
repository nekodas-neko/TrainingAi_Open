import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  actionFailure,
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
