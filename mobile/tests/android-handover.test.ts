import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyUpgrade } from '../scripts/verify-android-upgrade.mjs';
import { resolveAndroidSigning } from '../scripts/android-signing.mjs';

test('native CI reuses the old signing key and never silently substitutes it for incomplete explicit credentials', () => {
  const sample = Buffer.from('synthetic-keystore').toString('base64');
  const legacy = resolveAndroidSigning({ LEGACY_KEYSTORE_B64: sample });
  assert.equal(legacy.bytes.toString(), 'synthetic-keystore');
  assert.equal(legacy.keystorePassword, 'android');
  assert.equal(legacy.keyAlias, 'androiddebugkey');
  const explicit = resolveAndroidSigning({
    KEYSTORE_B64: sample,
    KEYSTORE_PASSWORD: 'sample-password',
    KEY_ALIAS: 'sample-alias',
    KEY_PASSWORD: 'sample-key-password',
    LEGACY_KEYSTORE_B64: sample,
  });
  assert.equal(explicit.keyAlias, 'sample-alias');
  assert.throws(
    () => resolveAndroidSigning({ KEYSTORE_B64: sample, LEGACY_KEYSTORE_B64: sample }),
    /Configure/,
  );
  assert.throws(() => resolveAndroidSigning({}), /Configure/);
  assert.throws(
    () => resolveAndroidSigning({ LEGACY_KEYSTORE_B64: '%%%' }),
    /empty or malformed/,
  );
});

test('APK upgrade comparison requires the same certificate/package and a higher version', () => {
  const installed = {
    package: 'com.trainingai.app',
    certificates: ['A'.repeat(64)],
    versionCode: 1489000,
  };
  const next = { ...installed, versionCode: 1489001 };
  assert.doesNotThrow(() => verifyUpgrade(installed, next));
  assert.throws(
    () => verifyUpgrade(installed, { ...next, package: 'com.trainingai.app.dev' }),
    /package ID/,
  );
  assert.throws(
    () => verifyUpgrade(installed, { ...next, certificates: ['B'.repeat(64)] }),
    /signing certificate/,
  );
  assert.throws(
    () => verifyUpgrade(installed, { ...next, versionCode: 1 }),
    /version code higher/,
  );
  assert.throws(() => verifyUpgrade(installed, installed), /version code higher/);
});

test('legacy inventory is read-only, filters scoped rows, and prints no private row values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trainingai-inventory-test-'));
  const database = join(directory, 'synthetic.db');
  try {
    const db = new DatabaseSync(database);
    db.exec(`CREATE TABLE body_metrics(id TEXT,weight_kg REAL);
      CREATE TABLE mutations_outbox(user_id TEXT,domain TEXT,payload TEXT);
      INSERT INTO body_metrics VALUES('private-record-id',77);
      INSERT INTO mutations_outbox VALUES('one','body_metrics','private-secret-payload'),('two','sleep_sessions','other-private-secret');`);
    db.close();
    const before = readFileSync(database);
    const output = execFileSync(
      process.execPath,
      ['scripts/inspect-legacy-data.mjs', '--database', database, '--user', 'one'],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const result = JSON.parse(output);
    assert.equal(result.readOnly, true);
    assert.deepEqual(result.outbox, [{ domain: 'body_metrics', count: 1 }]);
    assert.equal(
      result.inventory.find((row: { table: string }) => row.table === 'body_metrics').ownership,
      'requires verified cache-owner marker',
    );
    assert.equal(
      result.inventory.find((row: { table: string }) => row.table === 'mutations_outbox').rows,
      1,
    );
    assert.doesNotMatch(output, /private-secret|private-record|other-private/);
    assert.deepEqual(readFileSync(database), before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
