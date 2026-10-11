import { createContext, useContext, useSyncExternalStore, type PropsWithChildren } from 'react';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { AppearancePreferences } from './appearance';

const Context = createContext<{
  saveStatus: 'saved' | 'saving' | 'error';
  retry: () => void;
} | null>(null);

export function AppearanceProvider({
  preferences,
  children,
}: PropsWithChildren<{ preferences: AppearancePreferences }>) {
  const state = useSyncExternalStore(
    preferences.subscribe,
    preferences.getSnapshot,
    preferences.getSnapshot,
  );
  return (
    <Context.Provider value={{ saveStatus: state.saveStatus, retry: preferences.retry }}>
      <ThemeProvider
        mode={state.mode}
        brand={state.brand}
        onModeChange={preferences.setMode}
        onBrandChange={preferences.setBrand}
      >
        {children}
      </ThemeProvider>
    </Context.Provider>
  );
}

export function useAppearancePreferences() {
  const value = useContext(Context);
  if (!value) {
    throw new Error('AppearanceProvider is required.');
  }
  return value;
}
