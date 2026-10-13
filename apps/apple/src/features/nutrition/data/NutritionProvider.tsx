import { todayInTz } from '@trainingai/shared/date-utils';
import { randomUUID } from 'expo-crypto';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { z } from 'zod';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { useAccountContext } from '../../account/AccountProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { nutritionPaths } from './models';
import { NutritionStore, emptyNutrition } from './NutritionStore';
const Context = createContext<{
  store: NutritionStore | null;
  today: string;
  region: string;
  setRegion: (region: string) => void;
  timezone: string;
} | null>(null);
const noop = () => () => {};
export function NutritionProvider({ children }: PropsWithChildren) {
  const { dataReader } = useAccountContext();
  const storage = useLocalStorage();
  const resources = useWorkoutResources();
  const timezone = dataReader?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [today, setToday] = useState(() => todayInTz(timezone));
  const store = useMemo(
    () =>
      dataReader
        ? new NutritionStore(
            storage.account(dataReader.origin, dataReader.userId),
            dataReader,
            randomUUID,
            () => {
              resources?.invalidate(nutritionPaths);
              void resources?.refreshVisible();
            },
          )
        : null,
    [dataReader, storage, resources],
  );
  useEffect(() => {
    const update = () => setToday(todayInTz(timezone));
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [timezone]);
  return (
    <NutritionStoreProvider store={store} today={today} timezone={timezone}>
      {children}
    </NutritionStoreProvider>
  );
}
export function NutritionStoreProvider({
  store,
  today,
  timezone,
  children,
}: PropsWithChildren<{ store: NutritionStore | null; today: string; timezone: string }>) {
  useEffect(() => {
    void store?.initialize().then(() => store.sync());
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void store?.sync();
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        void store?.sync();
      }
    }, 60000);
    return () => {
      subscription.remove();
      clearInterval(timer);
      store?.cancel();
    };
  }, [store]);
  const { value: preferences, setValue: setPreferences } = useWorkoutDraft(
    'nutrition-preferences',
    z.object({ region: z.string().max(10) }),
    { region: 'AU' },
  );
  const context = useMemo(
    () => ({
      store,
      today,
      timezone,
      region: preferences.region,
      setRegion: (region: string) => setPreferences({ region }),
    }),
    [store, today, timezone, preferences.region, setPreferences],
  );
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export function useNutrition(date?: string) {
  const context = useContext(Context);
  if (!context) {
    throw new Error('Nutrition provider missing.');
  }
  const state = useSyncExternalStore(
    context.store?.subscribe ?? noop,
    context.store?.getSnapshot ?? (() => emptyNutrition),
    () => emptyNutrition,
  );
  const day = date ?? context.today;
  const refresh = useCallback(
    async (manual = false) => {
      const kinds = [
        'mealTypes',
        'foods',
        'meals',
        'supplements',
        'targets',
        'logs',
        'answers',
        'checkin',
        'mealStatuses',
      ] as const;
      await Promise.all(kinds.map((kind) => context.store?.refresh(kind, day, manual)));
    },
    [context.store, day],
  );
  return {
    ...state,
    ...context,
    date: day,
    connected: !!context.store,
    view: context.store?.view(day) ?? {
      planLinks: {} as Record<string, string>,
      mealTypes: [],
      mealStatuses: {} as Record<
        string,
        import('@trainingai/shared/nutrition/meal-logging-status').MealLoggingStatus
      >,
      loggingComplete: false,
      foods: [],
      meals: [],
      supplements: [],
      targets: {},
      logs: [],
      checkin: null,
      answers: [],
      totals: null,
    },
    refresh,
  };
}
