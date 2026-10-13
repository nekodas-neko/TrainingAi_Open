import { createContext, useContext, type PropsWithChildren } from 'react';
import { useReports } from './useReports';

const Context = createContext<ReturnType<typeof useReports> | null>(null);
export function ReportsProvider({ children }: PropsWithChildren) {
  const value = useReports();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useReportsContext() {
  const value = useContext(Context);
  if (!value) {
    throw new Error('ReportsProvider is required.');
  }
  return value;
}
