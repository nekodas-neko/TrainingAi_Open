/**
 * Which actions vibrate (#3759). A new control follows this table; nothing else vibrates.
 *
 * | Action                                                              | Kind        |
 * |---------------------------------------------------------------------|-------------|
 * | A selection changes: tab, segmented control, page dots, chip,       | `selection` |
 * | choice tile, multi-choice, weekday, switch, stepper tick, wheel tick |             |
 * | A confirm: saving a set, finishing a workout, logging food,         | `success`   |
 * | a hold completing, an undo                                          |             |
 * | A destructive swipe passing its threshold, a reorder step           | `selection` |
 * | A gesture taking hold: sheet drag, reorder pick-up, section menu    | `impact`    |
 * | A plain press that navigates or opens (AppButton, IconButton, rows, | none        |
 * | cards)                                                              |             |
 *
 * The shared controls in `shared/ui` make these calls themselves, so a screen only calls
 * `feedback` for a confirm it owns. Ticks closer together than 120 ms are dropped. On Android the
 * calls go through the view haptics API, which follows the phone's own touch-vibration setting;
 * on iOS they follow the system haptics switch. There is no separate in-app setting.
 */
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
