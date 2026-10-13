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
      customHue: null,
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
      customHue: null,
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
        customHue: null,
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
      customHue: null,
      saveStatus: 'error',
    });
    assert.equal(await storage.get('appearance'), '{"mode":"dark","brand":"blue"}');
    preferences.retry();
    await settled(preferences);
    assert.deepEqual(preferences.getSnapshot(), {
      mode: 'dark',
      brand: 'purple',
      customHue: null,
      saveStatus: 'saved',
    });
    assert.deepEqual(JSON.parse((await storage.get('appearance'))!), {
      mode: 'dark',
      brand: 'purple',
      customHue: null,
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
      customHue: null,
      saveStatus: 'saved',
    });
    assert.deepEqual(JSON.parse((await storage.get('appearance'))!), {
      mode: 'dark',
      brand: 'purple',
      customHue: null,
    });
  } finally {
    fixture.connection.close();
  }
});

test('custom accents restore, survive mode changes and clear atomically when choosing the same preset', async () => {
  const fixture = sqliteFixture();
  try {
    const storage = (await createLocalStorage(fixture.database)).device();
    const preferences = new AppearancePreferences(storage);
    await preferences.load();
    preferences.setCustomHue(217);
    preferences.setMode('light');
    await settled(preferences);
    const reopened = new AppearancePreferences(storage);
    await reopened.load();
    assert.equal(reopened.getSnapshot().customHue, 217);
    assert.equal(reopened.getSnapshot().mode, 'light');
    reopened.setBrand('green');
    await settled(reopened);
    assert.equal(JSON.parse((await storage.get('appearance'))!).customHue, null);
    for (const hue of [NaN, Infinity, -1, 361]) reopened.setCustomHue(hue);
    assert.equal(reopened.getSnapshot().customHue, null);
  } finally {
    fixture.connection.close();
  }
});

test('custom accent text and button labels remain readable across the hue circle in both themes', async () => {
  const { customAccent, contrast } = await import('../src/shared/theme/custom-accent.ts');
  for (const mode of ['light', 'dark'] as const) {
    for (let hue = 0; hue <= 360; hue++) {
      const colors = customAccent(hue, mode);
      assert.ok(
        contrast(colors.brandText, colors.brandSurface) >= 4.5,
        `${mode} text at ${hue}`,
      );
      assert.ok(contrast(colors.brand, colors.onBrand) >= 4.5, `${mode} button at ${hue}`);
      assert.ok(contrast(colors.brandText, colors.surface) >= 4.5, `${mode} surface at ${hue}`);
    }
  }
});

test('appearance writes are serialized so slower older selections cannot overwrite the latest colour', async () => {
  let release: () => void = () => {};
  let stored: string | null = null;
  let writes = 0;
  const preferences = new AppearancePreferences({
    get: async () => stored,
    set: async (_, value) => {
      if (++writes === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      stored = value;
    },
    remove: async () => {},
  });
  preferences.setCustomHue(20);
  await Promise.resolve();
  preferences.setCustomHue(280);
  preferences.setBrand('cyan');
  assert.equal(writes, 1);
  release();
  await settled(preferences);
  assert.deepEqual(JSON.parse(stored!), { mode: 'system', brand: 'cyan', customHue: null });
});
