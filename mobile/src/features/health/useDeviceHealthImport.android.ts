import type { DeviceImportState } from './data/device-import';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useAccountContext } from '../account/AccountProvider';
import { useLocalStorage } from '../../core/storage/StorageProvider';
import { useWorkoutResources } from '../workouts/data/WorkoutDataProvider';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { healthReadPaths } from '../../core/sync/health-invalidation';
import {
  HealthConnectImportStore,
  emptyHealthConnectImport,
} from './data/HealthConnectImportStore';
import {
  grantedHealthConnectTypes,
  requestHealthConnectTypes,
  readHealthConnectPage,
  readHealthConnectChanges,
  requestHealthConnectHistoryPermission,
  hasHealthConnectHistoryPermission,
} from '../../integrations/health-connect/reader';
import { loadFirstHandSources } from './data/first-hand-sources';
const noSubscribe = () => () => {};
export function useDeviceHealthImport(): DeviceImportState {
  const { dataReader } = useAccountContext(),
    storage = useLocalStorage(),
    resources = useWorkoutResources();
  const { invalidate } = useWorkoutContext();
  const store = useMemo(
    () =>
      dataReader
        ? new HealthConnectImportStore(
            storage.account(dataReader.origin, dataReader.userId),
            dataReader,
            {
              permissions: grantedHealthConnectTypes,
              request: requestHealthConnectTypes,
              history: readHealthConnectPage,
              changes: readHealthConnectChanges,
              historyPermission: requestHealthConnectHistoryPermission,
              hasHistoryPermission: hasHealthConnectHistoryPermission,
            },
            () => {
              resources?.invalidate(healthReadPaths);
              invalidate();
              void resources?.refreshVisible();
            },
            undefined,
            // #3115: whether Oura Cloud is connected, from the readiness payload's
            // `connectedSources`, so the Oura app's own records are not imported twice.
            () => loadFirstHandSources(resources, dataReader.timezone),
          )
        : null,
    [dataReader, storage, resources, invalidate],
  );
  useEffect(() => {
    void store?.run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void store?.run(!!store.getSnapshot().pending);
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void store?.run(!!store.getSnapshot().pending);
    }, 60000);
    return () => {
      clearInterval(timer);
      subscription.remove();
      store?.cancel();
    };
  }, [store]);
  const state = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? (() => emptyHealthConnectImport),
    () => emptyHealthConnectImport,
  );
  return { ...state, store, refresh: () => store?.run(true) ?? Promise.resolve() };
}
