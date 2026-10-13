import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useAccountContext } from '../account/AccountProvider';
import { useLocalStorage } from '../../core/storage/StorageProvider';
import { useWorkoutJournal } from '../workouts/logging/WorkoutJournalProvider';
import { useActivities } from '../activities/data/ActivityProvider';
import { PlatformStore } from './data/PlatformStore';
import { CalendarStore } from './data/CalendarStore';
import { AlertScheduler } from './data/AlertScheduler';
import { planAlerts } from './data/alert-plan';
import {
  nativeAlerts,
  alertPermission,
  observeAlerts,
} from '../../integrations/notifications/platform';
import { nativeCalendar } from '../../integrations/calendar/platform';

const Context = createContext<{
  store: PlatformStore | null;
  calendar: CalendarStore | null;
  alertError: string | null;
  permission: boolean;
  enableAlerts: (key?: 'restAlerts' | 'walkCues') => Promise<void>;
  refresh: () => void;
  opened: Record<string, unknown> | null;
} | null>(null);
export function PlatformProvider({ children }: PropsWithChildren) {
  const { dataReader } = useAccountContext(),
    storage = useLocalStorage();
  const journal = useWorkoutJournal(),
    activity = useActivities();
  const [tick, setTick] = useState(0),
    [permission, setPermission] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, unknown> | null>(null);
  const stores = useMemo(() => {
    if (!dataReader) return { settings: null, calendar: null };
    const accountStorage = storage.account(dataReader.origin, dataReader.userId);
    return {
      settings: new PlatformStore(accountStorage, randomUUID),
      calendar: new CalendarStore(accountStorage, nativeCalendar),
    };
  }, [storage, dataReader]);
  const scheduler = useMemo(() => new AlertScheduler(nativeAlerts), []);
  const state = useSyncExternalStore(
    stores.settings?.subscribe ?? (() => () => {}),
    stores.settings?.getSnapshot ?? (() => null),
    () => null,
  );
  useEffect(() => {
    void stores.settings?.initialize();
    void stores.calendar?.initialize();
    return () => stores.calendar?.cancel();
  }, [stores]);
  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const allowed = await alertPermission();
        if (active) {
          setPermission(allowed);
          setTick((value) => value + 1);
        }
      } catch {
        if (active) setPermission(false);
      }
    }
    void check();
    const listener = AppState.addEventListener('change', (value) => {
      if (value === 'active') void check();
    });
    let unsubscribe: (() => void) | undefined;
    void observeAlerts((data) => {
      if (active) setOpened(data);
    })
      .then((fn) => {
        if (active) unsubscribe = fn;
        else fn();
      })
      .catch(() => {});
    return () => {
      active = false;
      listener.remove();
      unsubscribe?.();
    };
  }, []);
  const serialized =
    state?.ready && permission
      ? JSON.stringify(planAlerts(state.settings, journal.data.workouts, activity.session))
      : '[]';
  useEffect(() => {
    let active = true;
    void scheduler.reconcile(JSON.parse(serialized)).then(
      () => {
        if (active) setAlertError(null);
      },
      () => {
        if (active) setAlertError('Could not update alerts. Retry from integration settings.');
      },
    );
    return () => {
      active = false;
    };
  }, [serialized, tick, scheduler]);
  useEffect(
    () => () => {
      void scheduler.reconcile([]).catch(() => {});
    },
    [scheduler],
  );
  useEffect(() => {
    if (state?.ready && journal.ready)
      void stores.calendar?.sync(journal.data.workouts, state.settings).catch(() => {});
  }, [state, stores.calendar, journal.ready, journal.data.workouts, tick]);
  const enableAlerts = useCallback(
    async (key?: 'restAlerts' | 'walkCues') => {
      if (!stores.settings) throw new Error('Sign in to enable alerts.');
      const allowed = await alertPermission(true);
      setPermission(allowed);
      if (!allowed) throw new Error('Allow notifications in phone settings to receive alerts.');
      if (key) await stores.settings.configure({ [key]: true });
      setTick((value) => value + 1);
    },
    [stores.settings],
  );
  const value = useMemo(
    () => ({
      store: stores.settings,
      calendar: stores.calendar,
      alertError,
      permission,
      enableAlerts,
      refresh: () => setTick((value) => value + 1),
      opened,
    }),
    [stores, alertError, permission, opened, enableAlerts],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
const empty = () => null;
const noSubscribe = () => () => {};
export function usePlatformIntegrations() {
  const context = useContext(Context);
  if (!context) throw new Error('PlatformProvider is required.');
  const state = useSyncExternalStore(
    context.store?.subscribe ?? noSubscribe,
    context.store?.getSnapshot ?? empty,
    empty,
  );
  const calendarState = useSyncExternalStore(
    context.calendar?.subscribe ?? noSubscribe,
    context.calendar?.getSnapshot ?? empty,
    empty,
  );
  return { ...context, state, calendarState };
}
