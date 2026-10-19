/**
 * The cue when a rest ends with the app open (#3084): one buzz, and one sound.
 *
 * The current app beeps and buzzes at rest end whether or not notifications are allowed
 * (`components/workout-screen.tsx`, `playBeep()` + `hapticSuccess()`). Here the sound normally
 * comes from the rest notification's channel, which plays even in the foreground without showing
 * the banner. When that notification cannot sound (permission refused, no scheduler in the build,
 * or the schedule failed), the app plays its own beep instead, so a rest never ends silently and
 * never ends with two sounds.
 */
export type RestCueOutputs = { haptic(): void; beep(): void };

/** Whether the rest notification will make the sound, so the app must not add its own. */
export function notificationSoundsRest(permission: boolean, alertError: string | null) {
  return permission && !alertError;
}

/**
 * The timer and the notification listener can both report the same rest ending; the first one
 * cues it and the second is ignored.
 */
export function createRestCue(outputs: RestCueOutputs) {
  let lastCue: string | null = null;
  return (cueId: string, notificationSounds: boolean) => {
    if (lastCue === cueId) return;
    lastCue = cueId;
    outputs.haptic();
    if (!notificationSounds) outputs.beep();
  };
}
