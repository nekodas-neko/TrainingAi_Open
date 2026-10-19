import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { labelFilename, saveImageToGallery } from '../src/integrations/media-save/gallery.ts';
import type { MediaSave } from '../src/integrations/media-save/types.ts';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakeMedia(overrides: Partial<MediaSave> = {}) {
  const calls: { base64: string; filename: string; mimeType: string }[] = [];
  const media: MediaSave = {
    isAvailable: () => true,
    saveImage: async (base64, filename, mimeType) => {
      calls.push({ base64, filename, mimeType });
      return 'content://media/external/images/media/1';
    },
    ...overrides,
  };
  return { media, calls };
}

test('a label saves as a PNG with the current app\'s file name', async () => {
  const { media, calls } = fakeMedia();
  const outcome = await saveImageToGallery(media, png, labelFilename('Chilli con carne (big)'));
  assert.deepEqual(outcome, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filename, 'Chilli con carne big-label.png');
  assert.equal(calls[0].mimeType, 'image/png');
  assert.deepEqual(Uint8Array.from(atob(calls[0].base64), (c) => c.charCodeAt(0)), png);
});

test('a large label survives the base64 encoding intact', async () => {
  const { media, calls } = fakeMedia();
  const big = Uint8Array.from({ length: 300_000 }, (_, i) => i % 251);
  await saveImageToGallery(media, big, 'x-label.png');
  assert.deepEqual(Uint8Array.from(atob(calls[0].base64), (c) => c.charCodeAt(0)), big);
});

test('a failed save comes back as a reason, never a throw', async () => {
  const failure = new Error('save failed: IOException: disk full');
  const { media } = fakeMedia({ saveImage: async () => Promise.reject(failure) });
  const outcome = await saveImageToGallery(media, png, 'x-label.png');
  assert.deepEqual(outcome, { ok: false, reason: failure.message, error: failure });
});

test('a refused write (no permission) is a stated failure, not a crash', async () => {
  const denied = new Error('SecurityException: Permission denial');
  const { media } = fakeMedia({ saveImage: async () => Promise.reject(denied) });
  const outcome = await saveImageToGallery(media, png, 'x-label.png');
  assert.equal(outcome.ok, false);
  assert.match(!outcome.ok ? outcome.reason : '', /Permission denial/);
});

test('below Android 10 nothing is written and no permission is sought', async () => {
  const { media, calls } = fakeMedia({ isAvailable: () => false });
  const outcome = await saveImageToGallery(media, png, 'x-label.png');
  assert.deepEqual(outcome, { ok: false, reason: 'saving to the gallery needs Android 10 or newer' });
  assert.equal(calls.length, 0);
});

test('a build without the module says so instead of pretending to save', async () => {
  assert.deepEqual(await saveImageToGallery(null, png, 'x-label.png'), {
    ok: false,
    reason: 'this app build cannot save images — update the APK',
  });
});

test('the save asks for no permission on any save, first or later', () => {
  // Android 10+ lets an app insert into Pictures/ through MediaStore with no grant, so the module
  // declares none and the JS never requests one.
  const manifest = readFileSync('modules/media-save/android/src/main/AndroidManifest.xml', 'utf8');
  assert.doesNotMatch(manifest, /<uses-permission/);
  const kotlin = readFileSync(
    'modules/media-save/android/src/main/java/expo/modules/mediasave/MediaSaveModule.kt',
    'utf8',
  );
  assert.doesNotMatch(kotlin, /requestPermissions|Manifest\.permission/);
  assert.match(kotlin, /"\$\{Environment\.DIRECTORY_PICTURES\}\/\$albumDir"/);
  assert.match(kotlin, /private val albumDir = "TrainingAI"/);
  // The same album as the current app.
  const reference = readFileSync(
    '../android/app/src/main/java/com/trainingai/app/media/MediaSavePlugin.kt',
    'utf8',
  );
  assert.match(reference, /private val albumDir = "TrainingAI"/);
});
