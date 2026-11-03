import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useLocalStorage } from '../../core/storage/StorageProvider';
import { healthAlert } from '../../integrations/notifications/platform';
import { useAccountContext } from '../account/AccountProvider';
import { usePlatformIntegrations } from '../platform/PlatformProvider';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { useHealthData } from './data/HealthDataProvider';
import { runHealthAlerts } from './data/health-alerts';
import { batterySpec, readinessSpec } from './data/models';

/**
 * The health anomaly alerts (illness, high stress, low readiness), checked when the app opens and
 * when it comes back to the foreground (#2843). It reads the two views Home already loads, so it
 * adds no request, and waits for both to settle so a low-readiness alert is not sent a moment
 * before the stress alert that would have replaced it.
 */
export function HealthAlerts() {
  const reader = useAccountContext().dataReader;
  const connected = reader !== null;
  const { today } = useHealthData();
  const readiness = useWorkoutResource(readinessSpec(today), connected);
  const battery = useWorkoutResource(batterySpec(today), connected);
  const { state, permission } = usePlatformIntegrations();
  const local = useLocalStorage();
  const storage = useMemo(
    () => (reader ? local.account(reader.origin, reader.userId) : null),
    [local, reader],
  );
  const [resumed, setResumed] = useState(0);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') setResumed((value) => value + 1);
    });
    return () => listener.remove();
  }, []);
  const ready = state?.ready === true;
  const enabled = state?.settings.healthAlerts ?? false;
  const scope = state?.settings.scope;
  const settled = !readiness.loading && !battery.loading;
  useEffect(() => {
    if (!storage || !ready || !settled) return;
    void runHealthAlerts({
      storage,
      enabled,
      permission,
      today,
      sources: { readiness: readiness.data, battery: battery.data },
      post: (type, title, body) => healthAlert(type, title, body, scope),
    }).catch(() => undefined);
  }, [storage, ready, settled, enabled, permission, today, readiness.data, battery.data, resumed, scope]);
  return null;
}
