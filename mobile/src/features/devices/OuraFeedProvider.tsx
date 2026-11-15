import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { useAccountContext } from '../account/AccountProvider';
import { ouraFeedLastDataAt } from './data/oura';

// When Oura data last reached the server (#2861), for the quiet "Oura · updated 7:05 am" line on the
// Readiness and Sleep cards. Read from the connection status the Devices screen shows; null when
// Oura is not connected, nothing has arrived, or the status could not be read.
//
// #3794: a connection Oura stopped sharing (`reauthRequired`) still answers `lastDataAt`, and it is
// kept: that is exactly when the line has to appear, showing the data going stale. Only the field's
// absence clears it, never the grant's state.
// The line appears three hours after the last data, so the clock only has to be roughly right.
const TICK_MS = 5 * 60 * 1000;

type Feed = { lastDataAt: string | null; now: number };
const Context = createContext<Feed>({ lastDataAt: null, now: 0 });

export function OuraFeedProvider({ children }: PropsWithChildren) {
  const { dataReader } = useAccountContext();
  const [lastDataAt, setLastDataAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dataReader) {
      setLastDataAt(null);
      return;
    }
    const read = async () => {
      const at = ouraFeedLastDataAt(await dataReader.get('/api/oura/connection').catch(() => null));
      // A failed read keeps what was known: offline must not make old data look new, or the reverse.
      if (at !== undefined && mounted.current) setLastDataAt(at);
      if (mounted.current) setNow(Date.now());
    };
    void read();
    const timer = setInterval(() => void read(), TICK_MS);
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') void read();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
    };
  }, [dataReader]);
  const value = useMemo(() => ({ lastDataAt, now }), [lastDataAt, now]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOuraFeed() {
  return useContext(Context);
}
