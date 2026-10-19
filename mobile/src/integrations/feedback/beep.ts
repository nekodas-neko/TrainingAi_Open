import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// The current app's rest beep, synthesised natively (modules/rest-beep). Absent on iOS and on
// builds made before the module existed, where the rest ends with the buzz alone.
const restBeep =
  Platform.OS === 'android' ? requireOptionalNativeModule<{ play(): void }>('RestBeep') : null;

/** Never throws: a missing beep must never break the timer that asked for it. */
export function playBeep() {
  try {
    restBeep?.play();
  } catch {}
}
