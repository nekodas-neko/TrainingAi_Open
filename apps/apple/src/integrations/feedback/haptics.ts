import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

let lastFeedbackAt = 0;
export function feedback(kind: 'selection' | 'success' | 'impact' = 'selection') {
  if (Platform.OS !== 'ios' || Date.now() - lastFeedbackAt < 120) return;
  try {
    if (!requireOptionalNativeModule('ExpoHaptics')) return;
    lastFeedbackAt = Date.now();
    void import('expo-haptics')
      .then((haptics) =>
        kind === 'success'
          ? haptics.notificationAsync(haptics.NotificationFeedbackType.Success)
          : kind === 'impact'
            ? haptics.impactAsync(haptics.ImpactFeedbackStyle.Light)
            : haptics.selectionAsync(),
      )
      .catch(() => {});
  } catch {}
}
