import { useEffect, useState } from 'react';
import { useLocalStorage } from '../../core/storage/StorageProvider';
import { useAccountContext } from '../account/AccountProvider';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { ringBatterySpec } from '../health/data/body-models';
import { RING_ALERT_KEY, onRingAlertSaved, parseRingAlert, ringAlertWanted } from './data/ring-battery';

/** Whether the ring's low-battery alert is on for a ring that has a reading (#3434). */
export function useRingBatteryAlertOn() {
  const connected = useAccountContext().dataReader !== null;
  const hasReading = !!useWorkoutResource(ringBatterySpec, connected).data?.latest;
  const storage = useLocalStorage().device();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () =>
      void storage
        .get(RING_ALERT_KEY)
        .catch(() => null)
        .then((raw) => live && setEnabled(ringAlertWanted(parseRingAlert(raw), true)));
    read();
    const stop = onRingAlertSaved(read);
    return () => {
      live = false;
      stop();
    };
  }, [storage]);
  return enabled && hasReading;
}
