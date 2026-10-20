import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { todayInTz } from '@trainingai/shared/date-utils';
import { useAccountContext } from '../../account/AccountProvider';
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { HealthStore, emptyHealthState, overlayBody, overlaySleep } from './HealthStore';
import { manualHealthWritePaths } from './manual-write-paths';
import { useAppleSleep } from '../HealthProvider';
import { mergeAppleSleep } from '../../../integrations/apple-health/sleep-data';

const Context = createContext<{
  store: HealthStore | null;
  timezone: string;
  today: string;
} | null>(null);
const noSubscribe = () => () => {};
export function HealthDataProvider({ children }: PropsWithChildren) {
  const { dataReader } = useAccountContext();
  const storage = useLocalStorage();
  const resources = useWorkoutResources();
  const workouts = useWorkoutContext();
  const store = useMemo(
    () =>
      dataReader
        ? new HealthStore(
            storage.account(dataReader.origin, dataReader.userId),
            dataReader,
            randomUUID,
            () => {
              resources?.invalidate(manualHealthWritePaths);
              const day = todayInTz(
                dataReader.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
              );
              for (const section of ['sleep', 'readiness', 'activity', 'heart-rate']) {
                void resources?.clearDraft(`health-insight:${section}:${day}`).catch(() => {});
              }
              void resources?.refreshVisible();
              workouts.invalidate();
            },
          )
        : null,
    [dataReader, storage, resources, workouts.invalidate],
  );
  useEffect(
    () =>
      resources?.subscribeInvalidation((paths) => {
        if (paths.includes('/api/body-metadata') || paths.includes('/api/sleep-sessions')) {
          void store?.invalidateRecords();
        }
      }),
    [resources, store],
  );
  return <HealthStoreProvider store={store}>{children}</HealthStoreProvider>;
}
export function HealthStoreProvider({
  store,
  children,
}: PropsWithChildren<{ store: HealthStore | null }>) {
  const { timezone } = useWorkoutContext();
  const [today, setToday] = useState(() => todayInTz(timezone));
  useEffect(() => {
    const update = () => setToday(todayInTz(timezone));
    update();
    const timer = setInterval(update, 60_000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        update();
      }
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [timezone]);
  useEffect(() => {
    void store?.initialize().then(() => store.sync());
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void store?.sync();
        void store?.refresh();
      }
    });
    const retry = setInterval(() => {
      if (AppState.currentState === 'active') {
        void store?.sync();
      }
    }, 60_000);
    return () => {
      listener.remove();
      clearInterval(retry);
      store?.cancel();
    };
  }, [store]);
  const context = useMemo(() => ({ store, timezone, today }), [store, timezone, today]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export function useHealthData() {
  const apple = useAppleSleep();
  const context = useContext(Context);
  if (!context) {
    throw new Error('Health records provider is missing.');
  }
  const { store, timezone, today } = context;
  const state = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? (() => emptyHealthState),
    () => emptyHealthState,
  );
  return {
    ...state,
    store,
    timezone,
    today,
    connected: !!store,
    hasSleepRecords: state.sleep !== null || apple.ready,
    appleSleep: apple,
    body: state.denied ? null : overlayBody(state.body, state.operations, today),
    sleep: state.denied
      ? []
      : mergeAppleSleep(overlaySleep(state.sleep ?? [], state.operations), apple.nights),
    refresh: () => {
      void store?.refresh(true);
    },
  };
}
