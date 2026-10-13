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
import { useAccountContext } from '../../account/AccountProvider';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { useWorkoutContext } from '../WorkoutProvider';
import type { TrainingState } from './TrainingStore';
import {
  WorkoutResources,
  emptyResource,
  resourceKey,
  type ResourceSpec,
} from './WorkoutResources';

const Context = createContext<WorkoutResources | null>(null);
const noSubscribe = () => () => {};
export function WorkoutDataProvider({ children }: PropsWithChildren) {
  const account = useAccountContext();
  const storage = useLocalStorage();
  const workouts = useWorkoutContext();
  const connection = account.dataReader;
  const resources = useMemo(
    () =>
      connection
        ? new WorkoutResources(
            storage.account(connection.origin, connection.userId),
            connection,
            Date.now,
            randomUUID,
            workouts.invalidate,
          )
        : null,
    [storage, connection, workouts.invalidate],
  );
  return <WorkoutResourcesProvider resources={resources}>{children}</WorkoutResourcesProvider>;
}
export function WorkoutResourcesProvider({
  resources,
  children,
}: PropsWithChildren<{ resources: WorkoutResources | null }>) {
  useEffect(() => {
    void resources?.changes.initialize().catch(() => {});
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void resources?.changes.sync();
        void resources?.refreshVisible();
      }
    });
    const retry = setInterval(() => {
      if (AppState.currentState === 'active') {
        void resources?.changes.sync();
      }
    }, 60_000);
    return () => {
      listener.remove();
      clearInterval(retry);
      resources?.cancel();
    };
  }, [resources]);
  return <Context.Provider value={resources}>{children}</Context.Provider>;
}
export function useWorkoutResources() {
  return useContext(Context);
}
const emptyTraining = { ready: false, syncing: false, error: null, operations: [] };
export function useTrainingSync() {
  const resources = useWorkoutResources();
  const state = useSyncExternalStore<
    Pick<TrainingState, 'ready' | 'syncing' | 'error' | 'operations'>
  >(
    resources?.changes.subscribe ?? noSubscribe,
    resources?.changes.getSnapshot ?? (() => emptyTraining),
    () => emptyTraining,
  );
  return { ...state, store: resources?.changes ?? null };
}
export function useWorkoutResource<T>(spec: ResourceSpec<T>, enabled = true) {
  const resources = useWorkoutResources();
  const key = resourceKey(spec);
  const state = useSyncExternalStore(
    resources?.subscribe ?? noSubscribe,
    () => resources?.state(spec) ?? emptyResource<T>(),
    () => emptyResource<T>(),
  );
  useEffect(() => {
    void resources?.load(spec, false, !enabled);
  }, [resources, key, enabled]);
  return {
    ...state,
    connected: !!resources,
    refresh: () => {
      void resources?.load(spec, true);
    },
    resources,
  };
}
