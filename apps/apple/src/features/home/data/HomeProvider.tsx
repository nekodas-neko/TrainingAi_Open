import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { todayInTz } from '@trainingai/shared/date-utils';
import { useAccountContext } from '../../account/AccountProvider';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { HomeStore, emptyHome } from './HomeStore';

const Context = createContext<HomeStore | null>(null);
const noSubscribe = () => () => {};
export function HomeProvider({ children }: PropsWithChildren) {
  const { dataReader } = useAccountContext();
  const storage = useLocalStorage();
  const resources = useWorkoutResources();
  const workouts = useWorkoutContext();
  const store = useMemo(
    () =>
      dataReader
        ? new HomeStore(
            storage.account(dataReader.origin, dataReader.userId),
            dataReader,
            randomUUID,
            () => {
              resources?.invalidate([
                '/api/user/preferences',
                '/api/user/profile',
                '/api/day-timeline',
                '/api/mood',
                '/api/readiness-score',
                '/api/body-battery',
                '/api/next-session',
                '/api/workout-data',
                '/api/ai-periodization',
              ]);
              workouts.invalidate();
              void resources?.refreshVisible();
            },
          )
        : null,
    [dataReader, storage, resources, workouts.invalidate],
  );
  return <HomeStoreProvider store={store}>{children}</HomeStoreProvider>;
}
export function HomeStoreProvider({
  store,
  children,
}: PropsWithChildren<{ store: HomeStore | null }>) {
  useEffect(() => {
    void store?.initialize().then(() => store.sync());
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void store?.sync();
        const day = todayInTz(
          store?.connection.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        );
        void store?.refresh('preferences', day);
        void store?.refresh('mood', day);
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        void store?.sync();
      }
    }, 60_000);
    return () => {
      listener.remove();
      clearInterval(timer);
      store?.cancel();
    };
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useHome() {
  const store = useContext(Context);
  const { today } = useHealthData();
  const state = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? (() => emptyHome),
    () => emptyHome,
  );
  useEffect(() => {
    void store?.refresh('preferences', today);
    void store?.refresh('mood', today);
  }, [store, today]);
  return {
    ...state,
    store,
    mood: state.denied ? undefined : state.moods[today],
    preferences: state.denied ? {} : state.preferences,
  };
}
