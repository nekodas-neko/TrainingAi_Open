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
