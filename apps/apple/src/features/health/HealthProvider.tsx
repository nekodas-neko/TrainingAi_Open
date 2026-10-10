import { createContext, useContext, type PropsWithChildren } from 'react';
import { useHealthReadings } from './useHealthReadings';

const Context = createContext<ReturnType<typeof useHealthReadings> | null>(null);
export function HealthProvider({ children }: PropsWithChildren) {
  const value = useHealthReadings();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useHealthContext() {
  const value = useContext(Context);
  if (!value) {
    throw new Error('HealthProvider is required.');
  }
  return value;
}
