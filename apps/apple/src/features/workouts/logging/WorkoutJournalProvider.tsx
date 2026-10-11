import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { useAccountContext } from '../../account/AccountProvider';
import { useWorkoutContext } from '../WorkoutProvider';
import { WorkoutJournalStore, type JournalState } from './WorkoutJournalStore';
import { emptyJournal } from './workout';
import { useWorkoutResources } from '../data/WorkoutDataProvider';

const empty: JournalState = {
  data: emptyJournal({ origin: '', userId: '' }),
  ready: false,
  busy: false,
  syncing: false,
  saveStatus: 'saved',
  message: null,
  savedFallbackFor: null,
};
const emptySnapshot = () => empty;
const emptySubscribe = () => () => {};
const Context = createContext<(JournalState & { controller: WorkoutJournalStore | null }) | null>(
  null,
);

export function WorkoutJournalProvider({ children }: PropsWithChildren) {
  const account = useAccountContext();
  const storage = useLocalStorage();
  const workouts = useWorkoutContext();
  const resources = useWorkoutResources();
  const uploaded = useCallback(() => {
    workouts.invalidate();
    resources?.invalidate([
      '/api/workout-data',
      '/api/ai-periodization',
      '/api/next-session',
      '/api/day-log',
      '/api/calendar-data',
      '/api/exercise-history',
      '/api/strength-trend',
      '/api/personal-records',
      '/api/weekly-stats',
      '/api/training-stress',
    ]);
    void resources?.refreshVisible();
  }, [workouts.invalidate, resources]);
  const connection = account.dataReader;
  const controller = useMemo(
    () =>
      connection
        ? new WorkoutJournalStore(
            storage.account(connection.origin, connection.userId),
            connection,
            randomUUID,
            Date.now,
            uploaded,
          )
        : null,
    [storage, connection, uploaded],
  );
  return (
    <WorkoutJournalStateProvider controller={controller}>{children}</WorkoutJournalStateProvider>
  );
}

export function WorkoutJournalStateProvider({
  controller,
  children,
}: PropsWithChildren<{ controller: WorkoutJournalStore | null }>) {
  const state = useSyncExternalStore(
    controller?.subscribe ?? emptySubscribe,
    controller?.getSnapshot ?? emptySnapshot,
    controller?.getSnapshot ?? emptySnapshot,
  );
  useEffect(() => {
    if (!controller) {
      return;
    }
    void controller.initialize();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void controller.sync();
      }
    });
    const retry = setInterval(() => {
      if (AppState.currentState === 'active') {
        void controller.sync();
      }
    }, 60_000);
    return () => {
      listener.remove();
      clearInterval(retry);
      controller.cancel();
    };
  }, [controller]);
  return <Context.Provider value={{ ...state, controller }}>{children}</Context.Provider>;
}

export function useWorkoutJournal() {
  const value = useContext(Context);
  if (!value) {
    throw new Error('WorkoutJournalProvider is required.');
  }
  return value;
}
