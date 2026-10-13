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
test('encodes queries on the fixed backend origin and sends only bearer credentials', async t => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://example.com');
    assert.equal(url.pathname, '/api/workout-data');
    assert.equal(url.searchParams.get('tab'), 'all&redirect=https://other.example');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-session');
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  });
  await createApiClient('https://example.com', async () => 'test-session').get('/api/workout-data', { tab: 'all&redirect=https://other.example' });
});
test('workout writes require bearer authentication and never send browser credentials', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(input), 'https://example.com/api/sync/push');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-session');
    assert.deepEqual(JSON.parse(String(init?.body)), { mutations: [] });
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  });
  await assert.rejects(createApiClient('https://example.com', async () => null).post('/api/sync/push', {}));
  assert.equal(calls, 0);
  await createApiClient('https://example.com', async () => 'test-session').post('/api/sync/push', { mutations: [] });
});
test('reports status errors and rejects HTML rather than treating it as API data', async t => {
  const client = createApiClient('https://example.com', async () => 'test-session');
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  await assert.rejects(client.get('/api/user/profile'), error => error instanceof ApiError && error.status === 401);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(client.get('/api/user/profile'), /Expected JSON/);
});
test('program and history verbs retain bearer authentication and reject unsafe paths', async t => {
  const methods: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(new URL(String(input)).origin, 'https://example.com');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-session');
    assert.equal(init?.credentials, 'omit'); methods.push(init!.method!);
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  });
  const client = createApiClient('https://example.com', async () => 'test-session');
  await client.put('/api/phase-sets/id', {}); await client.patch('/api/workout-entry', {}); await client.delete('/api/workout-templates', {});
  assert.deepEqual(methods, ['PUT', 'PATCH', 'DELETE']);
  await assert.rejects(client.put('https://other.example/api/phase-sets/id', {}));
  await assert.rejects(createApiClient('https://example.com', async () => null).delete('/api/workout-templates', {}));
});
test('exercise media uses the authenticated API alias and never leaks a token to external assets', async t => {
  const paths: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); paths.push(url.pathname);
    assert.equal(new Headers(init?.headers).get('authorization'), url.origin === 'https://example.com' ? 'Bearer test-session' : null);
    assert.equal(init?.redirect, 'error');
    return new Response(new Uint8Array([71,73,70]), { headers: { 'content-type': 'image/gif' } });
  });
  const client = createApiClient('https://example.com', async () => 'test-session');
  assert.match(await client.media('/exercise-media/gifs/male/press.gif'), /^data:image\/gif;base64,/);
  await client.media('https://cdn.example/press.gif');
  assert.equal(paths[0], '/api/exercise-media/gifs/male/press.gif');
  await assert.rejects(client.media('https://user:password@cdn.example/press.gif'));
  await assert.rejects(client.media('/api/user/profile'));
});

test('empty successful friend mutations are acknowledged without requiring JSON',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:204}));
  const client=createApiClient('https://example.com',async()=> 'test-session');
  assert.equal(await client.delete('/api/friends/10000000-0000-4000-8000-000000000001',undefined),undefined);
  assert.equal(await client.patch('/api/friends/10000000-0000-4000-8000-000000000001',{action:'decline'}),undefined);
});
