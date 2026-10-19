import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { HistoryDownload, emptyHistoryDownload } from '../../../core/sync/HistoryDownload';
import { useAccountContext } from '../../account/AccountProvider';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useHistoryQueue } from '../../workouts/data/HistoryQueueProvider';
import { historyDomains } from './history-domains';

const Context = createContext<HistoryDownload | null>(null);
const noSubscribe = () => () => {};
export function HistoryDownloadProvider({ children }: PropsWithChildren) {
  const connection = useAccountContext().dataReader;
  const storage = useLocalStorage();
  const resources = useWorkoutResources();
  const nutrition = useNutrition().store;
  const queue = useHistoryQueue().queue;
  const download = useMemo(
    () =>
      connection && resources
        ? new HistoryDownload(
            storage.account(connection.origin, connection.userId),
            connection,
            (plan) => historyDomains(plan, { resources, nutrition }),
          )
        : null,
    [storage, connection, resources, nutrition],
  );
  useEffect(() => {
    // Changes waiting on this phone upload before an interrupted download carries on, so it reads
    // days that already hold them. The history outbox also re-saves a day as each edit confirms.
    const resume = async () => {
      await Promise.allSettled([queue?.sync(), resources?.changes.sync(), nutrition?.sync()]);
      await download?.resumeIfInterrupted();
    };
    void resume();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void resume();
      }
    });
    return () => {
      listener.remove();
      download?.stop();
    };
  }, [download, queue, resources, nutrition]);
  return <Context.Provider value={download}>{children}</Context.Provider>;
}
export function useHistoryDownload() {
  const download = useContext(Context);
  const state = useSyncExternalStore(
    download?.subscribe ?? noSubscribe,
    download?.getSnapshot ?? (() => emptyHistoryDownload),
    () => emptyHistoryDownload,
  );
  return { ...state, download };
}
