import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { useAccountContext } from '../account/AccountProvider';
import { useLocalStorage } from '../../core/storage/StorageProvider';
import { WorkoutCatalogStore, type CatalogState } from './WorkoutCatalogStore';

type WorkoutContext = CatalogState & {
  signedIn: boolean;
  accountLoading: boolean;
  refresh: () => void;
  refreshIfStale: () => void;
  invalidate: () => void;
  timezone: string;
};
const Context = createContext<WorkoutContext | null>(null);
const empty: CatalogState = {
  status: 'loading',
  catalog: null,
  refreshing: false,
  refreshingManually: false,
  source: null,
  notice: null,
};
const subscribeEmpty = () => () => {};
const snapshotEmpty = () => empty;

export function WorkoutProvider({ children }: PropsWithChildren) {
  const account = useAccountContext();
  const storage = useLocalStorage();
  const reader = account.dataReader;
  const controller = useMemo(
    () =>
      reader
        ? new WorkoutCatalogStore(storage.account(reader.origin, reader.userId), reader)
        : null,
    [storage, reader],
  );
  return (
    <WorkoutCatalogProvider
      controller={controller}
      accountLoading={account.state.status === 'loading' || account.state.status === 'checking'}
      timezone={reader?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
    >
      {children}
    </WorkoutCatalogProvider>
  );
}

export function WorkoutCatalogProvider({
  controller,
  accountLoading = false,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  children,
}: PropsWithChildren<{
  controller: WorkoutCatalogStore | null;
  accountLoading?: boolean;
  timezone?: string;
}>) {
  const state = useSyncExternalStore(
    controller?.subscribe ?? subscribeEmpty,
    controller?.getSnapshot ?? snapshotEmpty,
    controller?.getSnapshot ?? snapshotEmpty,
  );
  useEffect(() => {
    if (!controller) {
      return;
    }
    void controller.initialize();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void controller.refreshIfStale();
      }
    });
    return () => {
      listener.remove();
      controller.cancel();
    };
  }, [controller]);
  const refresh = useCallback(() => {
    void controller?.refresh();
  }, [controller]);
  const refreshIfStale = useCallback(() => {
    void controller?.refreshIfStale();
  }, [controller]);
  const invalidate = useCallback(() => {
    void controller?.invalidate();
  }, [controller]);
  return (
    <Context.Provider
      value={{
        ...state,
        signedIn: controller !== null,
        accountLoading,
        refresh,
        refreshIfStale,
        invalidate,
        timezone,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useWorkoutContext() {
  const value = useContext(Context);
  if (!value) {
    throw new Error('WorkoutProvider is required.');
  }
  return value;
}
