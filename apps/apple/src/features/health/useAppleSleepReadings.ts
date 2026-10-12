import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { z } from 'zod';
import type { ScopedStorage } from '../../core/storage/LocalStorage';
import { readAppleSleep } from '../../integrations/apple-health/readSleep';
import { sleepSchema, type SleepRow } from './data/models';

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
          const nights = await readAppleSleep(timezone);
          if (current !== generation.current) {
            return;
          }
          if (nights.length) {
            const readAt = new Date().toISOString();
            await storage.set('apple-sleep.v1', JSON.stringify({ readAt, timezone, nights }));
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
              error: 'Could not refresh Apple Health sleep. Saved readings have been kept.',
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
    generation.current++;
    scope.current = { storage, timezone };
    lastAttempt.current = 0;
    pending.current = null;
    setState(emptyAppleSleep);
    void storage
      .get('apple-sleep.v1')
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
      generation.current++;
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
