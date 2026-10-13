import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useHealthReadings } from './useHealthReadings';
import { useAppleSleepReadings, emptyAppleSleep } from './useAppleSleepReadings';
import { useLocalStorage } from '../../core/storage/StorageProvider';
import { useAccountContext } from '../account/AccountProvider';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { useDeviceHealthImport } from './useDeviceHealthImport';
import { emptyAppleImport } from './data/AppleHealthImportStore';

const Context = createContext<ReturnType<typeof useHealthReadings> | null>(null);
const SleepContext = createContext<ReturnType<typeof useAppleSleepReadings> | null>(null);
const ImportContext = createContext<ReturnType<typeof useDeviceHealthImport> | null>(null);
export function HealthProvider({ children }: PropsWithChildren) {
  const storage = useLocalStorage();
  const { dataReader } = useAccountContext();
  const { timezone } = useWorkoutContext();
  const value = useHealthReadings(timezone);
  const scope = useMemo(
    () =>
      dataReader ? storage.account(dataReader.origin, dataReader.userId) : storage.device(),
    [storage, dataReader],
  );
  const sleep = useAppleSleepReadings(scope, timezone);
  const imported = useDeviceHealthImport();
  return (
    <ImportContext.Provider value={imported}>
      <SleepContext.Provider value={sleep}>
        <Context.Provider
          value={{
            ...value,
            connect: async (afterRead) => {
              const readings = await value.connect(afterRead);
              await sleep.refresh(true);
              if (readings) {
                await imported.store?.setEnabled(true).catch(() => {});
                await imported.refresh();
              }
              return readings;
            },
          }}
        >
          {children}
        </Context.Provider>
      </SleepContext.Provider>
    </ImportContext.Provider>
  );
}
export function useAppleImport() {
  return (
    useContext(ImportContext) ?? { ...emptyAppleImport, store: null, refresh: async () => {} }
  );
}
export function useAppleSleep() {
  return useContext(SleepContext) ?? { ...emptyAppleSleep, refresh: async () => {} };
}
export function AppleSleepProvider({
  value,
  children,
}: PropsWithChildren<{ value: ReturnType<typeof useAppleSleepReadings> }>) {
  return <SleepContext.Provider value={value}>{children}</SleepContext.Provider>;
}
export function useHealthContext() {
  const value = useContext(Context);
  if (!value) {
    throw new Error('HealthProvider is required.');
  }
  return value;
}
