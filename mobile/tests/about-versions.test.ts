import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appVersionLine,
  codeVersionLine,
  fetchServerVersion,
  parseServerVersion,
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
