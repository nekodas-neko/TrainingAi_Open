import { createContext, useContext, type PropsWithChildren } from 'react';
import type { LocalStorage } from './LocalStorage';

const Context = createContext<LocalStorage | null>(null);

export function StorageProvider({
  storage,
  children,
}: PropsWithChildren<{ storage: LocalStorage }>) {
  return <Context.Provider value={storage}>{children}</Context.Provider>;
}

export function useLocalStorage() {
  const storage = useContext(Context);
  if (!storage) {
    throw new Error('StorageProvider is required.');
  }
  return storage;
}
