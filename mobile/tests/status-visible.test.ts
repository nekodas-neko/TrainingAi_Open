import assert from 'node:assert/strict';
import { test } from 'node:test';
import { statusVisible } from '../src/features/health/data/status-visible.ts';

const idle = { loading: false, refreshing: false, error: null };

test('an idle, healthy resource takes no status slot', () => {
  assert.equal(statusVisible(idle), false);
});

test('loading, refreshing, an error or a signed-out account each take the slot', () => {
  assert.equal(statusVisible({ ...idle, loading: true }), true);
  assert.equal(statusVisible({ ...idle, refreshing: true }), true);
  assert.equal(statusVisible({ ...idle, error: 'offline' }), true);
  assert.equal(statusVisible({ ...idle, connected: false }), true);
});
