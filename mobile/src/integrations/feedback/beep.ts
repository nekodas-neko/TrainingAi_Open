import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// The current app's rest beep, synthesised natively (modules/rest-beep). Absent on iOS and on
// builds made before the module existed, where the rest ends with the buzz alone.
type RestBeep = {
  play(): void;
  schedule(atEpochMs: number): void;
  cancel(): void;
  isInPictureInPicture(): boolean;
};
const restBeep =
  Platform.OS === 'android' ? requireOptionalNativeModule<RestBeep>('RestBeep') : null;

/** Never throws: a missing beep must never break the timer that asked for it. */
export function playBeep() {
  try {
    restBeep?.play();
  } catch {}
}

/**
 * Arms the native beep and buzz for the rest's end. It sounds only if the app is in
 * picture-in-picture then, where JS timers do not run; on screen the JS cue does it.
 */
export function armRestEnd(atEpochMs: number) {
  try {
    restBeep?.schedule(atEpochMs);
  } catch {}
}

export function disarmRestEnd() {
  try {
    restBeep?.cancel();
  } catch {}
}

export function inPictureInPicture() {
  try {
    return restBeep?.isInPictureInPicture() ?? false;
  } catch {
    return false;
  }
}
