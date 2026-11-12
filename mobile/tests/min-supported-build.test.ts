import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appIdentityHeaders, createApiClient } from '../src/features/account/api/client.ts';
import { nativeAppVersion, nativeBuildCode } from '../src/integrations/app-info/platform.ts';
import {
  PREVIEW_APPLICATION_ID,
  RELEASE_APPLICATION_ID,
  downloadPageFor,
  fetchMinimumBuild,
  parseMinimumBuild,
  tooOldNotice,
} from '../src/integrations/app-info/versions.ts';

const origin = 'https://trainingai.test';

test('every call carries the build number and version, on a GET and a POST', async () => {
  const seen: { method: string; build: string | null; version: string | null }[] = [];
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      method: init?.method ?? 'GET',
      build: headers.get('x-app-build'),
      version: headers.get('x-app-version'),
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const api = createApiClient(origin, async () => 'tok', fetcher);
  await api.get('/api/x');
  await api.post('/api/y', { a: 1 });
  assert.deepEqual(seen, [
    { method: 'GET', build: nativeBuildCode, version: nativeAppVersion },
    { method: 'POST', build: nativeBuildCode, version: nativeAppVersion },
  ]);
});

test('the identity headers come from the build info and drop a value a header cannot carry', () => {
  assert.deepEqual(appIdentityHeaders('512', '0.2.0'), { 'X-App-Build': '512', 'X-App-Version': '0.2.0' });
  assert.deepEqual(appIdentityHeaders('512', 'v 1\n'), { 'X-App-Build': '512' });
  assert.deepEqual(appIdentityHeaders('', 'x'.repeat(41)), {});
});

test('the minimum reads a number, and null when missing, null, malformed or from an older server', () => {
  assert.equal(parseMinimumBuild({ version: '1.6.0', minSupportedNativeBuild: 512 }), 512);
  assert.equal(parseMinimumBuild({ version: '1.6.0', minSupportedNativeBuild: null }), null);
  // An older server: the field is not there at all.
  assert.equal(
    parseMinimumBuild({ version: '1.5.0', nativeVersion: null, nativeReleaseBuild: null }),
    null,
  );
  assert.equal(parseMinimumBuild({ minSupportedNativeBuild: '512' }), null);
  assert.equal(parseMinimumBuild({ minSupportedNativeBuild: 0 }), null);
  assert.equal(parseMinimumBuild({ minSupportedNativeBuild: 1.5 }), null);
  assert.equal(parseMinimumBuild(null), null);
});

test('the minimum fetch is null on failure and sends the identity headers', async () => {
  let build: string | null = null;
  const reply = (async (_input: string | URL | Request, init?: RequestInit) => {
    build = new Headers(init?.headers).get('x-app-build');
    return new Response(JSON.stringify({ minSupportedNativeBuild: 700 }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal(await fetchMinimumBuild(origin, reply), 700);
  assert.equal(build, nativeBuildCode);
  const down = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
  assert.equal(await fetchMinimumBuild(origin, down), null);
  assert.equal(await fetchMinimumBuild(undefined, reply), null);
});

test('the notice shows only below a non-null minimum', () => {
  assert.equal(tooOldNotice(RELEASE_APPLICATION_ID, '2520000', null), null);
  assert.equal(tooOldNotice(RELEASE_APPLICATION_ID, '2521000', 2521000), null);
  assert.equal(tooOldNotice(RELEASE_APPLICATION_ID, '2522000', 2521000), null);
  const notice = tooOldNotice(RELEASE_APPLICATION_ID, '2520000', 2521000);
  assert.equal(notice?.title, 'This version of TrainingAi is too old');
  assert.equal(notice?.pageUrl, downloadPageFor(RELEASE_APPLICATION_ID));
});

test('Preview is never held to the release minimum', () => {
  // Preview's codes are minutes since 2026-01-01, far below any release code (2,000,000 + ...).
  assert.equal(tooOldNotice(PREVIEW_APPLICATION_ID, '450000', 2521000), null);
  assert.equal(tooOldNotice(PREVIEW_APPLICATION_ID, '400', 512), null);
});

test('an unknown build or a build with no download page is never blocked', () => {
  assert.equal(tooOldNotice(RELEASE_APPLICATION_ID, '0', 512), null);
  assert.equal(tooOldNotice('com.trainingai.app.dev', '400', 512), null);
  assert.equal(tooOldNotice(null, '400', 512), null);
});

test('each build downloads from its own release page', () => {
  assert.match(downloadPageFor(RELEASE_APPLICATION_ID)!, /\/releases\/tag\/native-release-latest$/);
  assert.match(downloadPageFor(PREVIEW_APPLICATION_ID)!, /\/releases\/tag\/native-preview-latest$/);
});
