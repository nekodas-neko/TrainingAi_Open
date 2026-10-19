import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRestCue, notificationSoundsRest } from '../src/integrations/feedback/rest-cue.ts';

// What reaches the user's ears and hand when a rest ends with the app open. `channel` is the rest
// notification's own sound, which the foreground handler plays without a banner.
function restEnd(permission: boolean, alertError: string | null = null) {
  const heard = { haptic: 0, beep: 0, channel: 0 };
  const cue = createRestCue({ haptic: () => heard.haptic++, beep: () => heard.beep++ });
  const sounds = notificationSoundsRest(permission, alertError);
  const id = 'workout-1:1000:91000';
  // The provider's timer fires at the deadline…
  cue(id, sounds);
  // …and, when the alert was scheduled, the notification arrives too and its listener reports the
  // same rest (platform.native.ts calls restFeedback with the default `true`).
  if (sounds) {
    heard.channel++;
    cue(id, true);
  }
  return heard;
}

test('notifications allowed: one sound, from the channel, and one buzz', () => {
  assert.deepEqual(restEnd(true), { haptic: 1, beep: 0, channel: 1 });
});

test('notifications refused: the app beeps itself, and buzzes once', () => {
  assert.deepEqual(restEnd(false), { haptic: 1, beep: 1, channel: 0 });
});

test('allowed but the schedule failed: no notification will sound, so the app beeps', () => {
  assert.deepEqual(restEnd(true, 'Could not update alerts. Retry from integration settings.'), {
    haptic: 1,
    beep: 1,
    channel: 0,
  });
});

test('a new rest cues again; the same rest never cues twice', () => {
  const heard = { haptic: 0, beep: 0 };
  const cue = createRestCue({ haptic: () => heard.haptic++, beep: () => heard.beep++ });
  cue('w:1:2', false);
  cue('w:1:2', false);
  cue('w:3:4', false);
  assert.deepEqual(heard, { haptic: 2, beep: 2 });
});

test('the channel the allowed path relies on does sound in the foreground', () => {
  const src = readFileSync('src/integrations/notifications/platform.native.ts', 'utf8');
  assert.match(src, /'training-timers'[\s\S]*?sound: 'default'/);
  assert.match(src, /shouldPlaySound: notification\.request\.content\.data\?\.owner === ALERT_OWNER/);
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
