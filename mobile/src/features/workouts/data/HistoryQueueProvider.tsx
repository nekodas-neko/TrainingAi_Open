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
import { useWorkoutResources } from './WorkoutDataProvider';
import { HistoryOutbox, type HistoryQueueState } from './HistoryOutbox';
import { healthReadPaths } from '../../../core/sync/health-invalidation';
import { calendarSpec, daySpec } from './models';

const Context = createContext<HistoryOutbox | null>(null);
const empty: HistoryQueueState = { ready: false, operations: [], syncing: false, error: null };
const noSubscribe = () => () => {};
export function HistoryQueueProvider({ children }: PropsWithChildren) {
  const account = useAccountContext();
  const storage = useLocalStorage();
  const resources = useWorkoutResources();
  const workouts = useWorkoutContext();
  const connection = account.dataReader;
  const queue = useMemo(
    () =>
      connection
        ? new HistoryOutbox(
            storage.account(connection.origin, connection.userId),
            connection,
            randomUUID,
            (change) => {
              if (change) {
                resources?.applyHistory(change);
              }
              resources?.invalidate([
                '/api/day-log',
                '/api/calendar-data',
                '/api/streak-data',
                '/api/exercise-history',
                '/api/strength-trend',
                '/api/personal-records',
                '/api/weekly-stats',
                ...(!change ? healthReadPaths : []),
              ]);
              if (!change) {
                void resources?.refreshVisible();
              }
              workouts.invalidate();
            },
            Date.now,
            async (change) => {
              const date = change.date.replace(/\//g, '-');
              await Promise.all([
                resources?.resave(daySpec(date)),
                resources?.resave(
                  calendarSpec(Number(date.slice(0, 4)), Number(date.slice(5, 7))),
                ),
              ]);
            },
          )
        : null,
    [storage, connection, resources, workouts.invalidate],
  );
  return <HistoryQueueStateProvider queue={queue}>{children}</HistoryQueueStateProvider>;
}
export function HistoryQueueStateProvider({
  queue,
  children,
}: PropsWithChildren<{ queue: HistoryOutbox | null }>) {
  useEffect(() => {
    void queue?.initialize();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void queue?.sync();
      }
    });
    const retry = setInterval(() => {
      if (AppState.currentState === 'active') {
        void queue?.sync();
      }
    }, 60_000);
    return () => {
      listener.remove();
      clearInterval(retry);
      queue?.cancel();
    };
  }, [queue]);
  return <Context.Provider value={queue}>{children}</Context.Provider>;
}
export function useHistoryQueue() {
  const queue = useContext(Context);
  const state = useSyncExternalStore(
    queue?.subscribe ?? noSubscribe,
    queue?.getSnapshot ?? (() => empty),
    () => empty,
  );
  return { ...state, queue };
}
