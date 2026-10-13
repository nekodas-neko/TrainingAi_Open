import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useAccountContext } from '../account/AccountProvider';
import { useLocalStorage } from '../../core/storage/StorageProvider';
import { useWorkoutResources } from '../workouts/data/WorkoutDataProvider';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { AppleHealthImportStore, emptyAppleImport } from './data/AppleHealthImportStore';
import { readAppleImportPage } from '../../integrations/apple-health/importPage';
const noSubscribe = () => () => {};
export function useAppleHealthImport() {
  const { dataReader } = useAccountContext();
  const storage = useLocalStorage();
  const resources = useWorkoutResources();
  const workouts = useWorkoutContext();
  const store = useMemo(
    () =>
      dataReader
        ? new AppleHealthImportStore(
            storage.account(dataReader.origin, dataReader.userId),
            dataReader,
            readAppleImportPage,
            () => {
              resources?.invalidate([
                '/api/readiness-score',
                '/api/body-battery',
                '/api/body-metadata',
                '/api/sleep-sessions',
                '/api/health-trends',
                '/api/health/trends',
                '/api/day-log',
                '/api/day-timeline',
                '/api/sleep-verdict',
                '/api/nutrition/energy-balance',
                '/api/next-session',
                '/api/ai/health-insight',
              ]);
              workouts.invalidate();
              void resources?.refreshVisible();
            },
          )
        : null,
    [dataReader, storage, resources, workouts.invalidate],
  );
  useEffect(() => {
    void store?.run();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void store?.run(!!store.getSnapshot().pending);
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        void store?.run(!!store.getSnapshot().pending);
      }
    }, 60000);
    return () => {
      listener.remove();
      clearInterval(timer);
      store?.cancel();
    };
  }, [store]);
  const state = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? (() => emptyAppleImport),
    () => emptyAppleImport,
  );
  return { ...state, store, refresh: () => store?.run(true) ?? Promise.resolve() };
}
