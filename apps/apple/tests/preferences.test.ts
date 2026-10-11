import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalStorage } from '../src/core/storage/LocalStorage.ts';
import { AppearancePreferences } from '../src/features/settings/appearance.ts';
import { sqliteFixture } from './storage-fixture.ts';

function settled(preferences: AppearancePreferences) {
  if (preferences.getSnapshot().saveStatus !== 'saving') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const unsubscribe = preferences.subscribe(() => {
      if (preferences.getSnapshot().saveStatus !== 'saving') {
        unsubscribe();
        resolve();
      }
    });
  });
}

test('preferences restore without writing defaults and rapid changes save both selections', async () => {
  const fixture = sqliteFixture();
  try {
    const storage = (await createLocalStorage(fixture.database)).device();
    await storage.set('appearance', JSON.stringify({ mode: 'dark', brand: 'blue' }));
    const preferences = new AppearancePreferences(storage);
    await preferences.load();
    assert.deepEqual(preferences.getSnapshot(), {
      mode: 'dark',
      brand: 'blue',
      saveStatus: 'saved',
    });
    preferences.setBrand('purple');
    preferences.setMode('light');
    preferences.setMode('system');
    preferences.setBrand('gold');
    await settled(preferences);
    const reopened = new AppearancePreferences(storage);
    await reopened.load();
    assert.deepEqual(reopened.getSnapshot(), {
      mode: 'system',
      brand: 'gold',
      saveStatus: 'saved',
    });
  } finally {
    fixture.connection.close();
  }
});

test('malformed or obsolete preferences fall back without replacing stored data', async () => {
  const fixture = sqliteFixture();
  try {
    const storage = (await createLocalStorage(fixture.database)).device();
    for (const raw of ['{broken', 'null', '42', '{"mode":"old","brand":"__proto__"}']) {
      await storage.set('appearance', raw);
      const preferences = new AppearancePreferences(storage);
      await preferences.load();
      assert.deepEqual(preferences.getSnapshot(), {
        mode: 'system',
        brand: 'green',
        saveStatus: 'saved',
      });
      assert.equal(await storage.get('appearance'), raw);
    }
    await storage.set('appearance', '{"mode":"dark","brand":"removed"}');
    const preferences = new AppearancePreferences(storage);
    await preferences.load();
    assert.equal(preferences.getSnapshot().mode, 'dark');
  } finally {
    fixture.connection.close();
  }
});

test('failed saves keep the current selection, preserve prior data and allow a later retry', async () => {
  const fixture = sqliteFixture();
  try {
    let fail = false;
    const storage = (
      await createLocalStorage({
        ...fixture.database,
        async runAsync(sql, ...params) {
          if (fail) {
            fail = false;
            throw new Error('Disk full');
          }
          return fixture.database.runAsync(sql, ...params);
        },
      })
    ).device();
    await storage.set('appearance', '{"mode":"dark","brand":"blue"}');
    const preferences = new AppearancePreferences(storage);
    await preferences.load();
    fail = true;
    preferences.setBrand('purple');
    await settled(preferences);
    assert.deepEqual(preferences.getSnapshot(), {
      mode: 'dark',
      brand: 'purple',
      saveStatus: 'error',
    });
    assert.equal(await storage.get('appearance'), '{"mode":"dark","brand":"blue"}');
    preferences.retry();
    await settled(preferences);
    assert.deepEqual(preferences.getSnapshot(), {
      mode: 'dark',
      brand: 'purple',
      saveStatus: 'saved',
    });
    assert.deepEqual(JSON.parse((await storage.get('appearance'))!), {
      mode: 'dark',
      brand: 'purple',
    });
  } finally {
    fixture.connection.close();
  }
});

test('a read failure is reported instead of overwriting preferences with defaults', async () => {
  const preferences = new AppearancePreferences({
    async get() {
      throw new Error('Storage unavailable');
    },
    async set() {
      assert.fail('Must not write before loading preferences');
    },
    async remove() {
      assert.fail('Must not remove saved preferences');
    },
  });
  await assert.rejects(preferences.load(), /Storage unavailable/);
});

test('an earlier failed save cannot undo a later successful selection', async () => {
  const fixture = sqliteFixture();
  try {
    let fail = true;
    const storage = (
      await createLocalStorage({
        ...fixture.database,
        async runAsync(sql, ...params) {
          if (fail) {
            fail = false;
            throw new Error('Temporary write failure');
          }
          return fixture.database.runAsync(sql, ...params);
        },
      })
    ).device();
    const preferences = new AppearancePreferences(storage);
    await preferences.load();
    preferences.setMode('dark');
    preferences.setBrand('purple');
    await settled(preferences);
    assert.deepEqual(preferences.getSnapshot(), {
      mode: 'dark',
      brand: 'purple',
      saveStatus: 'saved',
    });
    assert.deepEqual(JSON.parse((await storage.get('appearance'))!), {
      mode: 'dark',
      brand: 'purple',
    });
  } finally {
    fixture.connection.close();
  }
});
