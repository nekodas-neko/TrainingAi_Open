import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

import { createRestCue } from './rest-cue';

let lastFeedbackAt = 0;
const restCue = createRestCue({
  haptic: () => feedback('success', true),
  beep: () => void import('./beep').then((m) => m.playBeep()).catch(() => {}),
});
/** The foreground rest-end cue: one buzz and the in-app beep (#3110). */
export function restFeedback(cueId: string) {
  restCue(cueId);
}
export function feedback(
  kind: 'selection' | 'success' | 'impact' = 'selection',
  force = false,
) {
  if (
    (Platform.OS !== 'ios' && Platform.OS !== 'android') ||
    (!force && Date.now() - lastFeedbackAt < 120)
  )
    return;
  try {
    if (!requireOptionalNativeModule('ExpoHaptics')) return;
    lastFeedbackAt = Date.now();
    void import('expo-haptics')
      .then((haptics) =>
        Platform.OS === 'android'
          ? haptics.performAndroidHapticsAsync(
              kind === 'success'
                ? haptics.AndroidHaptics.Confirm
                : kind === 'impact'
                  ? haptics.AndroidHaptics.Gesture_Start
                  : haptics.AndroidHaptics.Segment_Frequent_Tick,
            )
          : kind === 'success'
            ? haptics.notificationAsync(haptics.NotificationFeedbackType.Success)
            : kind === 'impact'
              ? haptics.impactAsync(haptics.ImpactFeedbackStyle.Light)
              : haptics.selectionAsync(),
      )
      .catch(() => {});
  } catch {}
}
