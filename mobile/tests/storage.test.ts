import assert from 'node:assert/strict';
import { mkdtempSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { migrateDatabase, StorageUpgradeRequired } from '../src/core/storage/migrations.ts';
import { sqliteFixture } from './storage-fixture.ts';

test('data survives reopening and migrations preserve existing records', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fitnessai-storage-'));
  const path = join(directory, 'test.sqlite');
  let fixture = sqliteFixture(path);
  try {
    const storage = await createLocalStorage(fixture.database);
    await storage.device().set('appearance', '{"mode":"dark"}');
    fixture.connection.close();
    fixture = sqliteFixture(path);
    const reopened = await createLocalStorage(fixture.database);
    assert.equal(await reopened.device().get('appearance'), '{"mode":"dark"}');
    assert.equal(
      (await fixture.database.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))
        ?.user_version,
      1,
    );
  } finally {
    fixture.connection.close();
    unlinkSync(path);
    rmdirSync(directory);
  }
});

test('account, backend and device storage stay separate, including removals', async () => {
  const fixture = sqliteFixture();
  try {
    const storage = await createLocalStorage(fixture.database);
    const first = storage.account('https://example.com', 'one');
    const second = storage.account('https://example.com', 'two');
    const otherBackend = storage.account('https://other.example.com', 'one');
    const device = storage.device();
    await Promise.all([
      first.set('same', 'first'),
      second.set('same', 'second'),
      otherBackend.set('same', 'other'),
      device.set('same', 'device'),
    ]);
    assert.equal(await storage.account('https://EXAMPLE.com:443/', 'one').get('same'), 'first');
    await first.remove('same');
    assert.equal(await first.get('same'), null);
    assert.equal(await second.get('same'), 'second');
    assert.equal(await otherBackend.get('same'), 'other');
    assert.equal(await device.get('same'), 'device');
    assert.throws(() => storage.account('https://user:secret@example.com', 'one'));
    assert.throws(() => storage.account('https://example.com/path', 'one'));
    assert.throws(() => storage.account('https://example.com', ''));
  } finally {
    fixture.connection.close();
  }
});

test('bound keys and values are literal data and rapid writes preserve call order', async () => {
  const fixture = sqliteFixture();
  try {
    const storage = (await createLocalStorage(fixture.database)).device();
    const key = "'; DROP TABLE local_values; --";
    await Promise.all([
      storage.set(key, 'one'),
      storage.set(key, 'two'),
      storage.set(key, 'three'),
    ]);
    assert.equal(await storage.get(key), 'three');
    await storage.set('another', 'safe');
    assert.equal(await storage.get('another'), 'safe');
  } finally {
    fixture.connection.close();
  }
});

test('a failed migration rolls back its schema and version and can be retried', async () => {
  const fixture = sqliteFixture();
  try {
    await assert.rejects(
      migrateDatabase({
        ...fixture.database,
        async execAsync(sql) {
          await fixture.database.execAsync(sql);
          if (sql.startsWith('CREATE TABLE')) {
            throw new Error('Interrupted migration');
          }
        },
      }),
      /Interrupted migration/,
    );
    assert.equal(
      await fixture.database.getFirstAsync(
        "SELECT name FROM sqlite_master WHERE name = 'local_values'",
      ),
      null,
    );
    assert.equal(
      (await fixture.database.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))
        ?.user_version,
      0,
    );
    const storage = await createLocalStorage(fixture.database);
    await storage.device().set('recovered', 'yes');
    assert.equal(await storage.device().get('recovered'), 'yes');
  } finally {
    fixture.connection.close();
  }
});

test('an older app refuses a newer database without resetting saved data', async () => {
  const fixture = sqliteFixture();
  try {
    const storage = await createLocalStorage(fixture.database);
    await storage.device().set('keep', 'saved');
    await fixture.database.execAsync('PRAGMA user_version = 2');
    await assert.rejects(createLocalStorage(fixture.database), StorageUpgradeRequired);
    assert.equal(await storage.device().get('keep'), 'saved');
    assert.equal(
      (await fixture.database.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))
        ?.user_version,
      2,
    );
  } finally {
    fixture.connection.close();
  }
});

test('holdsOtherAccounts sees data of any account but the one asked about, and ignores the device scope', async () => {
  const { database } = sqliteFixture();
  const storage = await createLocalStorage(database);
  const origin = 'https://example.com';
  await storage.device().set('theme', 'dark');
  assert.equal(await storage.holdsOtherAccounts(origin, 'u1'), false);
  await storage.account(origin, 'u1').set('k', 'v');
  assert.equal(await storage.holdsOtherAccounts(origin, 'u1'), false);
  await storage.account(origin, 'old').set('k', 'v');
  assert.equal(await storage.holdsOtherAccounts(origin, 'u1'), true);
  await storage.clearAllAccounts();
  assert.equal(await storage.holdsOtherAccounts(origin, 'u1'), false);
});
