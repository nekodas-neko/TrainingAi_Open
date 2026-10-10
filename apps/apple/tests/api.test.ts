import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient, ApiError } from '../src/features/account/api/client.ts';

test('rejects unsafe hosts and absolute paths before credentials can be sent', async () => {
  assert.throws(() => createApiClient('http://example.com', async () => 'secret'));
  assert.throws(() => createApiClient('https://user:password@example.com', async () => 'secret'));
  const client = createApiClient('https://example.com', async () => 'secret');
  await assert.rejects(client.get('https://other.example/api/profile'));
  await assert.rejects(client.get('//other.example/api/profile'));
});
test('requires authentication before making a network request', async () => {
  await assert.rejects(createApiClient('https://example.com', async () => null).get('/api/user/profile'), /Sign in/);
});
test('reports status errors and rejects HTML rather than treating it as API data', async t => {
  const client = createApiClient('https://example.com', async () => 'test-session');
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  await assert.rejects(client.get('/api/user/profile'), error => error instanceof ApiError && error.status === 401);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(client.get('/api/user/profile'), /Expected JSON/);
});
