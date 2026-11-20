import { useEffect } from 'react';
import { AppState } from 'react-native';
import { connectivity, probeWhileOffline, PROBE_INTERVAL_MS } from './Connectivity.ts';

/**
 * #3913: `listener` runs when the app comes back to the foreground and when the connection comes
 * back, so a screen that failed offline retries the way it does on reopening the app.
 */
export function onResume(listener: () => void) {
  const app = AppState.addEventListener('change', (state) => {
    if (state === 'active') listener();
  });
  const network = connectivity.subscribe(listener);
  return {
    remove() {
      app.remove();
      network();
    },
  };
}

/** Only when the connection comes back (not on every return to the foreground). */
export function onReconnect(listener: () => void) {
  return { remove: connectivity.subscribe(listener) };
}

type Probe = { get(path: string): Promise<unknown> } | null;
/**
 * While the phone last saw no connection, asks the server every 10 s (and on a return to the
 * foreground, and on the web build's `online` event) whether it is back. The answer goes through
 * the API client, which tells `connectivity`. A small authenticated read with its own rate limit.
 */
export function useConnectivityProbe(reader: Probe) {
  useEffect(() => {
    if (!reader) return;
    const check = probeWhileOffline(connectivity, () => reader.get('/api/account/data-epoch'));
    const tick = () => {
      if (AppState.currentState === 'active') void check();
    };
    const timer = setInterval(tick, PROBE_INTERVAL_MS);
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    const target = globalThis as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    target.addEventListener?.('online', tick);
    return () => {
      clearInterval(timer);
      app.remove();
      target.removeEventListener?.('online', tick);
    };
  }, [reader]);
}
