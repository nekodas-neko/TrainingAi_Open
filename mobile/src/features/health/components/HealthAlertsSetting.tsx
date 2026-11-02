import { useState } from 'react';
import { Linking } from 'react-native';
import { AppButton, AppText, SwitchRow } from '../../../shared/ui';
import { usePlatformIntegrations } from '../../platform/PlatformProvider';
import { alertPermissionAskable } from '../../../integrations/notifications/platform';

/** The settings row for the health anomaly alerts (#2843): illness, high stress, low readiness. */
export function HealthAlertsSetting() {
  const { state, store, permission, enableAlerts } = usePlatformIntegrations();
  const [error, setError] = useState<string | null>(null);
  const on = state?.settings.healthAlerts ?? true;
  const off = !!state?.ready && on && !permission;
  async function allow() {
    setError(null);
    try {
      if (await alertPermissionAskable()) await enableAlerts();
      else await Linking.openSettings();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not turn notifications on.');
    }
  }
  return (
    <>
      <SwitchRow
        label="Health anomaly alerts"
        value={on}
        disabled={!store || !state?.ready}
        onValueChange={(healthAlerts) => void store?.configure({ healthAlerts }).catch(() => {})}
      />
      <AppText variant="caption" tone="muted">
        A notification when illness signals, high stress or low readiness show up, checked when you
        open the app. At most once a day for each.
      </AppText>
      {off && (
        <>
          <AppText variant="caption" accessibilityRole="alert">
            Notifications are off for TrainingAi Preview, so these alerts can’t reach you. Turn
            them on in phone settings.
          </AppText>
          <AppButton title="Turn on notifications" variant="secondary" onPress={() => void allow()} />
        </>
      )}
      {error && (
        <AppText variant="caption" tone="muted" accessibilityRole="alert">
          {error}
        </AppText>
      )}
    </>
  );
}
