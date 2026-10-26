import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { homeWidgets } from '../../integrations/widgets/platform';
import { useHealthData } from '../health/data/HealthDataProvider';
import { drainPendingWater } from './pending-water';

/**
 * Records the water taps made on the home screen while the app was closed: when the account's
 * health records are ready, and each time the app comes to the front. One drain runs at a time.
 */
export function useWidgetWaterDrain(userId: string) {
  const { store, ready, denied } = useHealthData();
  const running = useRef(false);
  useEffect(() => {
    if (!homeWidgets || !store || !ready || denied) return;
    const drain = () => {
      if (running.current) return;
      running.current = true;
      void drainPendingWater(homeWidgets!, userId, (ml, date, id) => store.addWater(ml, date, id))
        .catch(() => {
          // The taps stay queued; the next foreground tries again.
        })
        .finally(() => {
          running.current = false;
        });
    };
    drain();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') drain();
    });
    return () => subscription.remove();
  }, [store, ready, denied, userId]);
}
