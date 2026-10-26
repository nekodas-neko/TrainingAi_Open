import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useLocalStorage } from '../../core/storage/StorageProvider';
import { deviceAlert } from '../../integrations/notifications/platform';
import { useAccountContext } from '../account/AccountProvider';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { ringBatterySpec } from '../health/data/body-models';
import { RING_ALERT_KEY, checkRingAlert, parseRingAlert } from './data/ring-battery';

/**
 * The ring's low-battery alert (#3069). The reading reaches the server with the Oura app's sync and
 * this phone learns of it when it asks, so the alert fires when the app is open or comes back to the
 * foreground and finds a low reading: once per low spell, at the level the owner set.
 */
export function RingBatteryAlerts() {
  const connected = useAccountContext().dataReader !== null;
  const battery = useWorkoutResource(ringBatterySpec, connected);
  const storage = useLocalStorage().device();
  const { refresh } = battery;
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => listener.remove();
  }, [refresh]);
  const latest = battery.data?.latest ?? null;
  useEffect(() => {
    if (!latest) return;
    let live = true;
    void (async () => {
      const settings = parseRingAlert(await storage.get(RING_ALERT_KEY).catch(() => null));
      const verdict = checkRingAlert(settings, {
        percent: latest.percent,
        charging: latest.charging === true,
        ageMinutes: (Date.now() - latest.tsMs) / 60_000,
      });
      if (!live) return;
      if (verdict.settings.fired !== settings.fired)
        await storage.set(RING_ALERT_KEY, JSON.stringify(verdict.settings)).catch(() => undefined);
      if (verdict.notify)
        await deviceAlert(
          'Oura ring battery low',
          `${Math.round(latest.percent)}% left. Put it on the charger.`,
        ).catch(() => undefined);
    })();
    return () => {
      live = false;
    };
  }, [latest?.tsMs, latest?.percent, latest?.charging, storage]);
  return null;
}
