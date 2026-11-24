import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { HistoryDownload, emptyHistoryDownload } from '../../../core/sync/HistoryDownload';
import { useAccountContext } from '../../account/AccountProvider';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useHistoryQueue } from '../../workouts/data/HistoryQueueProvider';
import { historyDomains } from './history-domains';
import { followHistoryDownload } from './history-download-resume';
import { syncNowShared } from './sync-now-state';

const Context = createContext<HistoryDownload | null>(null);
const noSubscribe = () => () => {};
export function HistoryDownloadProvider({ children }: PropsWithChildren) {
  const connection = useAccountContext().dataReader;
  const storage = useLocalStorage();
  const resources = useWorkoutResources();
  const nutrition = useNutrition().store;
  const queue = useHistoryQueue().queue;
  // Sign-out, an expired session, delete-account or another user: Sync now starts over (#3906).
  const accountKey = connection ? `${connection.origin}|${connection.userId}` : null;
  useEffect(() => {
    syncNowShared.setAccount(accountKey);
  }, [accountKey]);
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
    // The history outbox also re-saves a day as each edit confirms.
    const listener = followHistoryDownload(download, () => [
      queue?.sync(),
      resources?.changes.sync(),
      nutrition?.sync(),
    ]);
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
