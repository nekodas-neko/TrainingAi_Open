import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

let lastFeedbackAt = 0;
let lastRestCue: string | null = null;
export function restFeedback(cueId: string) {
  if (lastRestCue === cueId) return;
  lastRestCue = cueId;
  feedback('success', true);
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
