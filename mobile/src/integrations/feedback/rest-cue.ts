/**
 * The cue when a rest ends: one buzz and exactly one sound, wherever the app is (#3084, #3110).
 *
 * The current app beeps and buzzes at rest end whether or not notifications are allowed, and its
 * beep is Web Audio on the media stream, so the ringer switch does not silence it
 * (`components/workout-screen.tsx`, `playBeep()` + `hapticSuccess()`). Preview matches that by
 * making its own beep the sound whenever the app is on screen:
 *
 * - **foreground**: the JS timer beeps and buzzes; the rest notification is told not to sound.
 * - **pip**: JS timers are paused, so the native module, armed when the rest started, beeps and
 *   buzzes; the notification, if any, is again silent.
 * - **background**: nothing of the app is visible, so the notification channel is the sound, as
 *   the current app's rest notification is. Without the permission there is none, also as there.
 */
export type RestVisibility = 'foreground' | 'pip' | 'background';
export type RestSoundSource = 'app' | 'native' | 'channel' | 'none';

export function restSoundSource(visibility: RestVisibility, permission: boolean): RestSoundSource {
  if (visibility === 'foreground') return 'app';
  if (visibility === 'pip') return 'native';
  return permission ? 'channel' : 'none';
}

export type RestCueOutputs = { haptic(): void; beep(): void };

/**
 * The foreground cue. The timer and the notification listener can both report the same rest
 * ending; the first one cues it and the second is ignored.
 */
export function createRestCue(outputs: RestCueOutputs) {
  let lastCue: string | null = null;
  return (cueId: string) => {
    if (lastCue === cueId) return;
    lastCue = cueId;
    outputs.haptic();
    outputs.beep();
  };
}
