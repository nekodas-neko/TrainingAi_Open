import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { guardHomeWidgets } from '../src/integrations/widgets/guarded.ts';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;

// Runs every config plugin in app.json against an empty manifest, as `expo prebuild` would.
async function mergedManifest() {
  const { getConfig } = require('expo/config');
  const { compileModsAsync } = require('expo/config-plugins');
  const { exp } = getConfig(root, { skipSDKVersionRequirement: true, isModdedConfig: true });
  const compiled = await compileModsAsync(exp, {
    projectRoot: root,
    platforms: ['android'],
    introspect: true,
    assertMissingModProviders: false,
  });
  return compiled._internal.modResults.android.manifest.manifest;
}

test('the merged Android manifest keeps RECORD_AUDIO, so Voice can ask for the microphone', async () => {
  const manifest = await mergedManifest();
  const entries = (manifest['uses-permission'] ?? []).filter(
    (p: { $: Record<string, string> }) => p.$['android:name'] === 'android.permission.RECORD_AUDIO',
  );
  assert.ok(entries.length > 0, 'RECORD_AUDIO is not declared');
  // A plugin passing `microphonePermission: false` writes tools:node="remove" for it (#3235).
  assert.ok(
    entries.every((p: { $: Record<string, string> }) => p.$['tools:node'] !== 'remove'),
    'a config plugin removes RECORD_AUDIO from the merged manifest',
  );
});

test('backups leave out the widget and workout-status preferences', () => {
  const { exclusions } = require('../src/integrations/auth/private-backups.cjs');
  const paths = exclusions.filter(([domain]: string[]) => domain === 'sharedpref').map(([, p]: string[]) => p);
  for (const name of ['trainingai_home_widgets.xml', 'workout-status.xml', 'SecureStore.xml']) {
    assert.ok(paths.includes(name), `${name} is backed up`);
  }
});

test('the widget guard refuses writes after a clear until resume()', () => {
  const calls: string[] = [];
  const guarded = guardHomeWidgets({
    writeSnapshot: (json) => calls.push(`write:${json}`),
    clearSnapshot: () => calls.push('clear'),
  });
  guarded.writeSnapshot('a');
  guarded.clearSnapshot();
  guarded.writeSnapshot('late write from the signed-out account');
  guarded.resume();
  guarded.writeSnapshot('b');
  assert.deepEqual(calls, ['write:a', 'clear', 'write:b']);
});
