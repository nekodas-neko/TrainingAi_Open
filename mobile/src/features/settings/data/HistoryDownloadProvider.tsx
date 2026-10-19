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
import { HistoryDownload, type HistoryDownloadState } from '../../../core/sync/HistoryDownload';
import { useAccountContext } from '../../account/AccountProvider';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { historyDomains } from './history-domains';

const Context = createContext<HistoryDownload | null>(null);
const empty: HistoryDownloadState = {
  ready: false,
  status: 'idle',
  plan: null,
  domains: [],
  done: 0,
  total: 0,
  error: null,
};
const noSubscribe = () => () => {};
export function HistoryDownloadProvider({ children }: PropsWithChildren) {
  const connection = useAccountContext().dataReader;
  const storage = useLocalStorage();
  const resources = useWorkoutResources();
  const nutrition = useNutrition().store;
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
    void download?.resumeIfInterrupted();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void download?.resumeIfInterrupted();
      }
    });
    return () => {
      listener.remove();
      download?.stop();
    };
  }, [download]);
  return <Context.Provider value={download}>{children}</Context.Provider>;
}
export function useHistoryDownload() {
  const download = useContext(Context);
  const state = useSyncExternalStore(
    download?.subscribe ?? noSubscribe,
    download?.getSnapshot ?? (() => empty),
    () => empty,
  );
  return { ...state, download };
}
