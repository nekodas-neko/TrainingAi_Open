import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appVersionLine,
  codeVersionLine,
  fetchReleaseBuild,
  fetchServerVersion,
  parseReleaseBuild,
  parseServerVersion,
  releaseBuildNotice,
  serverVersionLine,
} from '../src/integrations/app-info/versions.ts';

const reply = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('the app line shows the build code, and drops it when the code is 0', () => {
  assert.equal(appVersionLine('0.1.0', '440887'), 'App 0.1.0 (build 440887)');
  assert.equal(appVersionLine('0.1.0', '0'), 'App 0.1.0');
});

test('the code line shortens a baked sha and shows dev when none was baked', () => {
  assert.equal(codeVersionLine('1a2b3c4d5e6f7a8b9c0d'), 'Code 1a2b3c4');
  assert.equal(codeVersionLine(undefined), 'Code dev');
  assert.equal(codeVersionLine(''), 'Code dev');
  assert.equal(codeVersionLine('dev'), 'Code dev');
});

test('the status parse takes the version from a good response', () => {
  assert.equal(parseServerVersion({ ok: true, db: 'up', version: '1.514.0' }), '1.514.0');
  assert.equal(serverVersionLine('1.514.0'), 'Server 1.514.0');
});

test('the status parse refuses a bad shape', () => {
  assert.equal(parseServerVersion({ ok: true }), null);
  assert.equal(parseServerVersion({ version: 5 }), null);
  assert.equal(parseServerVersion(null), null);
  assert.equal(serverVersionLine(null), 'Server unreachable');
});

test('fetching the server version reads a good reply and reports failures as null', async () => {
  const base = 'https://example.up.railway.app';
  assert.equal(await fetchServerVersion(base, reply({ ok: true, db: 'up', version: '1.514.0' })), '1.514.0');
  assert.equal(await fetchServerVersion(base, reply({ nope: 1 })), null);
  assert.equal(await fetchServerVersion(base, reply({ ok: false, db: 'down', version: '1' }, 503)), null);
  const offline = (async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;
  assert.equal(await fetchServerVersion(base, offline), null);
  assert.equal(await fetchServerVersion(undefined, reply({ version: '1' })), null);
});

// #3723. The release build's "A newer build is available" notice.
const PAGE = 'https://github.com/nekodas-neko/TrainingAi_Open/releases/tag/native-release-latest' as const;
const published = { versionName: '0.2.0', versionCode: 512, pageUrl: PAGE };
const installed = (buildCode: string) => ({ version: '0.1.0', buildCode });

test('the release app shows the notice when the published build is newer', () => {
  assert.deepEqual(releaseBuildNotice('com.trainingai.app', installed('511'), published), {
    title: 'A newer build is available',
    message: 'v0.2.0 (build 512). You have v0.1.0 (build 511). Tap to download.',
    pageUrl: PAGE,
  });
});

test('the release app shows nothing when the published build is the same or older', () => {
  assert.equal(releaseBuildNotice('com.trainingai.app', installed('512'), published), null);
  assert.equal(releaseBuildNotice('com.trainingai.app', installed('600'), published), null);
  // An unknown installed code (the module missing) never asserts an update.
  assert.equal(releaseBuildNotice('com.trainingai.app', installed('0'), published), null);
});

test('Preview and development builds show nothing', () => {
  assert.equal(releaseBuildNotice('com.trainingai.app.preview', installed('1'), published), null);
  assert.equal(releaseBuildNotice('com.trainingai.app.dev', installed('1'), published), null);
  assert.equal(releaseBuildNotice(null, installed('1'), published), null);
});

test('an absent, null or malformed field shows nothing', () => {
  // A production server from before #3723 has no field at all.
  assert.equal(parseReleaseBuild({ version: '1.514.0', nativeVersion: '1.500.0' }), null);
  assert.equal(parseReleaseBuild({ nativeReleaseBuild: null }), null);
  assert.equal(parseReleaseBuild({ nativeReleaseBuild: { ...published, versionCode: '512' } }), null);
  assert.equal(parseReleaseBuild({ nativeReleaseBuild: { ...published, pageUrl: 'https://evil.example/' } }), null);
  assert.equal(parseReleaseBuild(null), null);
  assert.equal(releaseBuildNotice('com.trainingai.app', installed('1'), null), null);
  assert.deepEqual(parseReleaseBuild({ nativeReleaseBuild: published }), published);
});

test('fetching the release build reads /api/version and reports failures as null', async () => {
  const base = 'https://example.up.railway.app';
  let asked = '';
  const fetcher = (async (url: URL) => {
    asked = String(url);
    return new Response(JSON.stringify({ version: '1.514.0', nativeReleaseBuild: published }));
  }) as unknown as typeof fetch;
  assert.deepEqual(await fetchReleaseBuild(base, fetcher), published);
  assert.equal(asked, `${base}/api/version`);
  assert.equal(await fetchReleaseBuild(base, reply({ version: '1.514.0' })), null);
  assert.equal(await fetchReleaseBuild(base, reply({}, 500)), null);
  assert.equal(await fetchReleaseBuild(undefined, reply({ nativeReleaseBuild: published })), null);
});
