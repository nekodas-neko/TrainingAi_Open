import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { z } from 'zod';
import type { ScopedStorage } from '../../core/storage/LocalStorage';
import { readDeviceSleep } from '../../integrations/device-health/readSleep';
import { deviceHealthName } from '../../integrations/device-health/platform';
import { sleepSchema, type SleepRow } from './data/models';
const cacheKey = Platform.OS === 'android' ? 'health-connect-sleep.v1' : 'apple-sleep.v1';

const cacheSchema = z.object({
  readAt: z.string().datetime(),
  timezone: z.string(),
  nights: z.array(sleepSchema),
});
export const emptyAppleSleep = {
  ready: false,
  busy: false,
  error: null as string | null,
  nights: [] as SleepRow[],
  readAt: null as string | null,
};
export function useAppleSleepReadings(storage: ScopedStorage, timezone: string) {
  const [state, setState] = useState(emptyAppleSleep);
  const generation = useRef(0);
  const scope = useRef({ storage, timezone });
  const lastAttempt = useRef(0);
  const pending = useRef<Promise<void> | null>(null);
  const refresh = useCallback(
    (manual = false): Promise<void> => {
      if (pending.current) {
        return pending.current;
      }
      if (!manual && Date.now() - lastAttempt.current < 300_000) {
        return Promise.resolve();
      }
      const current = generation.current;
      lastAttempt.current = Date.now();
      setState((value) => ({ ...value, busy: true, error: null }));
      const work = (async () => {
        try {
          const nights = await readDeviceSleep(timezone);
          if (current !== generation.current) {
            return;
          }
          if (nights.length) {
            const readAt = new Date().toISOString();
            await storage.set(cacheKey, JSON.stringify({ readAt, timezone, nights }));
            if (current === generation.current) {
              setState({ ready: true, busy: false, error: null, nights, readAt });
            }
          } else {
            setState((value) => ({ ...value, ready: true, busy: false }));
          }
        } catch {
          if (current === generation.current) {
            setState((value) => ({
              ...value,
              ready: true,
              busy: false,
              error: `Could not refresh ${deviceHealthName} sleep. Saved readings have been kept.`,
            }));
          }
        } finally {
          if (current === generation.current) {
            pending.current = null;
          }
        }
      })();
      pending.current = work;
      return work;
    },
    [storage, timezone],
  );
  useEffect(() => {
    let active = true;
    const cycle = ++generation.current;
    scope.current = { storage, timezone };
    lastAttempt.current = 0;
    pending.current = null;
    setState(emptyAppleSleep);
    void storage
      .get(cacheKey)
      .then((raw) => {
        if (!active) {
          return;
        }
        const parsed = raw ? cacheSchema.safeParse(JSON.parse(raw)) : null;
        if (parsed?.success && parsed.data.timezone === timezone && lastAttempt.current === 0) {
          setState({ ...emptyAppleSleep, ready: true, ...parsed.data });
        }
        void refresh();
      })
      .catch(() => {
        if (active) {
          void refresh();
        }
      });
    const listener = AppState.addEventListener('change', (value) => {
      if (value === 'active') {
        void refresh();
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        void refresh();
      }
    }, 300_000);
    return () => {
      active = false;
      generation.current = cycle + 1;
      listener.remove();
      clearInterval(timer);
    };
  }, [storage, timezone, refresh]);
  return {
    ...(scope.current.storage === storage && scope.current.timezone === timezone
      ? state
      : emptyAppleSleep),
    refresh,
  };
}
