import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// #3711: Preview's reminders showed a generic Android robot. expo-notifications falls back to the
// launcher icon (an adaptive icon, which Android cannot draw as a status-bar glyph) unless the
// manifest names a small icon and colour. Every notification Preview posts through expo-notifications
// (timers, reminders, device battery, health alerts) reads these two entries, so pinning them
// covers every channel at once.
const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;

async function mainApplication() {
  const { getConfig } = require('expo/config');
  const { compileModsAsync } = require('expo/config-plugins');
  const { exp } = getConfig(root, { skipSDKVersionRequirement: true, isModdedConfig: true });
  const compiled = await compileModsAsync(exp, {
    projectRoot: root,
    platforms: ['android'],
    introspect: true,
    assertMissingModProviders: false,
  });
  return {
    app: compiled._internal.modResults.android.manifest.manifest.application[0],
    colors: compiled._internal.modResults.android.colors,
  };
}

test('every expo notification gets the app small icon and accent colour (#3711)', async () => {
  const { app, colors } = await mainApplication();
  const meta = Object.fromEntries(
    (app['meta-data'] ?? []).map((m: { $: Record<string, string> }) => [
      m.$['android:name'],
      m.$['android:resource'],
    ]),
  );
  assert.equal(meta['expo.modules.notifications.default_notification_icon'], '@drawable/notification_icon');
  assert.equal(meta['expo.modules.notifications.default_notification_color'], '@color/notification_icon_color');
  const color = colors.resources.color.find(
    (c: { $: { name: string } }) => c.$.name === 'notification_icon_color',
  );
  assert.equal(color?._, '#00c84e');
});

test('the notification icon is the white dumbbell on transparent, not a full-colour image', () => {
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  const [, options] = config.plugins.find(
    (p: unknown) => Array.isArray(p) && p[0] === 'expo-notifications',
  );
  const file = new URL(`../${options.icon}`, import.meta.url);
  assert.ok(existsSync(file), `${options.icon} is missing`);
  const png = readFileSync(file);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  // IHDR colour type 6 is RGBA: Android draws a small icon from its alpha channel alone.
  assert.equal(png[25], 6);
});

// #3711 (20 Nov): the notification's large icon is the launcher icon, and Preview's was Expo's
// placeholder / Android's robot because app.json named no icon at all. The launcher art is the
// current app's dumbbell, copied from the root android/ project's mipmaps.
test('the launcher icon and adaptive layers are named and are real 1024 px PNGs (#3711)', () => {
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
  const adaptive = config.android?.adaptiveIcon;
  assert.ok(adaptive, 'android.adaptiveIcon is not set');
  const files = [
    config.icon,
    adaptive.foregroundImage,
    adaptive.backgroundImage,
    adaptive.monochromeImage,
  ];
  for (const f of files) {
    assert.equal(typeof f, 'string');
    const file = new URL(`../${f}`, import.meta.url);
    assert.ok(existsSync(file), `${f} is missing`);
    const png = readFileSync(file);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 1024, `${f} width`);
    assert.equal(png.readUInt32BE(20), 1024, `${f} height`);
  }
});

test('the prebuild writes the adaptive launcher icon with its monochrome layer (#3711)', async () => {
  const { getConfig } = require('expo/config');
  const { exp } = getConfig(root, { skipSDKVersionRequirement: true, isModdedConfig: true });
  assert.equal(exp.android.adaptiveIcon.foregroundImage, './assets/android-icon-foreground.png');
  assert.equal(exp.icon, './assets/icon.png');
});
