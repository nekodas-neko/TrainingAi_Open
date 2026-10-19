import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRestCue, restSoundSource } from '../src/integrations/feedback/rest-cue.ts';

const visibilities = ['foreground', 'pip', 'background'] as const;
const ringers = ['normal', 'vibrate', 'silent'] as const;

// What is heard when a rest ends. The app's beep and the native beep are on the media stream, so
// the ringer does not silence them; the notification channel's sound follows the ringer.
function heardAtRestEnd(
  visibility: (typeof visibilities)[number],
  permission: boolean,
  ringer: (typeof ringers)[number],
) {
  const source = restSoundSource(visibility, permission);
  return {
    source,
    audible:
      source === 'app' || source === 'native' ? 1 : source === 'channel' && ringer === 'normal' ? 1 : 0,
  };
}

test('on screen, every permission and ringer combination gives exactly one audible sound', () => {
  for (const visibility of ['foreground', 'pip'] as const)
    for (const permission of [true, false])
      for (const ringer of ringers) {
        const { audible, source } = heardAtRestEnd(visibility, permission, ringer);
        assert.equal(audible, 1, `${visibility}, permission ${permission}, ${ringer}: ${source}`);
        // Never the channel on screen: it would follow the ringer, or be a second sound.
        assert.notEqual(source, 'channel');
      }
});

test('foreground is the app\'s beep, picture-in-picture the native one', () => {
  assert.equal(restSoundSource('foreground', true), 'app');
  assert.equal(restSoundSource('foreground', false), 'app');
  assert.equal(restSoundSource('pip', true), 'native');
  assert.equal(restSoundSource('pip', false), 'native');
});

test('in the background the notification is the sound, as the current app\'s is', () => {
  assert.equal(restSoundSource('background', true), 'channel');
  // No notification and no visible app: silent, as the current app is with notifications refused.
  assert.equal(restSoundSource('background', false), 'none');
});

test('the foreground cue is one buzz and one beep, even when both the timer and the notification report it', () => {
  const heard = { haptic: 0, beep: 0 };
  const cue = createRestCue({ haptic: () => heard.haptic++, beep: () => heard.beep++ });
  cue('workout-1:1000:91000');
  cue('workout-1:1000:91000');
  assert.deepEqual(heard, { haptic: 1, beep: 1 });
  cue('workout-1:95000:185000');
  assert.deepEqual(heard, { haptic: 2, beep: 2 });
});

test('the notification handler silences rest alerts on screen and lets the channel sound only in the background', () => {
  const src = readFileSync('src/integrations/notifications/platform.native.ts', 'utf8');
  assert.match(src, /shouldPlaySound: ours && \(!rest \|\| source === 'channel'\)/);
  assert.match(src, /inPictureInPicture\(\)\s*\?\s*'pip'/);
});

test('the native cue is armed whenever a rest runs, not only in the foreground', () => {
  const src = readFileSync('src/features/platform/PlatformProvider.tsx', 'utf8');
  const arm = src.slice(src.indexOf('armRestEnd(restDeadline)') - 200, src.indexOf('armRestEnd(restDeadline)') + 120);
  assert.doesNotMatch(arm, /foreground/);
  assert.match(arm, /\[restCueId, restDeadline\]/);
  const kotlin = readFileSync(
    'modules/rest-beep/android/src/main/java/expo/modules/restbeep/RestBeepModule.kt',
    'utf8',
  );
  // It fires only in picture-in-picture, and not after a long sleep.
  assert.match(kotlin, /if \(late in 0\.\.graceMs && inPictureInPicture\(\)\) \{\s*play\(\)\s*buzz\(\)/);
});

test('the background channel the rest alert relies on has a sound', () => {
  const src = readFileSync('src/integrations/notifications/platform.native.ts', 'utf8');
  assert.match(src, /'training-timers'[\s\S]*?sound: 'default'/);
});

// The current app's components/workout/beep.ts: an 880 Hz sine, gain 0.4 ramping exponentially to
// 0.001 over 400 ms. Inlined rather than read, because the web app's folder goes at the switch-over.
test('the native beep is the current app\'s tone, on the media stream', () => {
  const kotlin = readFileSync(
    'modules/rest-beep/android/src/main/java/expo/modules/restbeep/RestBeepModule.kt',
    'utf8',
  );
  assert.match(kotlin, /private val seconds = 0\.4\b/);
  assert.match(kotlin, /private val frequency = 880\.0\b/);
  assert.match(kotlin, /private val startGain = 0\.4\b/);
  assert.match(kotlin, /private val endGain = 0\.001\b/);
  assert.match(kotlin, /\(endGain \/ startGain\)\.pow\(t \/ seconds\)/);
  // Media stream, no audio focus: music keeps playing, as under the WebView's Web Audio beep.
  assert.match(kotlin, /USAGE_MEDIA/);
  assert.doesNotMatch(kotlin, /requestAudioFocus/);
  // No permission and no dependency: the module declares nothing.
  const manifest = readFileSync('modules/rest-beep/android/src/main/AndroidManifest.xml', 'utf8');
  assert.doesNotMatch(manifest, /uses-permission/);
});
