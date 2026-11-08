import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { useAccountContext } from '../account/AccountProvider';
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
        customHue={state.customHue}
        onCustomHueChange={preferences.setCustomHue}
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

/**
 * Keeps the accent in step with the signed-in account (#3669 item 4): read on sign-in and each time
 * the app comes forward, so the switch-over install and a second device both pick up the accent
 * chosen in the current app, and a pick made here reaches the account.
 */
export function AppearanceAccountSync({ preferences }: { preferences: AppearancePreferences }) {
  const { dataReader } = useAccountContext();
  useEffect(() => {
    void preferences.attachAccount(dataReader ?? null);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void preferences.syncAccount();
    });
    return () => listener.remove();
  }, [preferences, dataReader]);
  return null;
}
