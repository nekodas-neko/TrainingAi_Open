import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { WeatherStore } from './data/WeatherStore';

const Context = createContext<WeatherStore | null>(null);
export function WeatherProvider({
  children,
  store,
}: PropsWithChildren<{ store: WeatherStore }>) {
  useEffect(() => {
    void store.refresh();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void store.refresh();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void store.refresh();
    }, 5 * 60_000);
    return () => {
      listener.remove();
      clearInterval(timer);
      store.cancel();
    };
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useWeather() {
  const store = useContext(Context);
  if (!store) throw new Error('WeatherProvider is required.');
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...state, store };
}
