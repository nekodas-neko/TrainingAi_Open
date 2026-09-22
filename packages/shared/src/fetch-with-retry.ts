import { cachedFetch } from "@/lib/sqlite/cache";

// cachedFetch surfaces data only on a cache hit or a 200 response; a 429/network blip on a
// fresh remount (e.g. right after activating a new program) silently yields nothing and never
// retries, leaving the readiness/sleep widgets blank until the app is restarted. This wraps a
// cachedFetch (or cachedFetchToday, for the today-guarded keys — pass it as `fetchFn`) with a
// few bounded retries when neither cache nor a successful fetch produced a response, so a
// transient failure self-heals instead of requiring a restart.
//
// **RV-85: it fixed the transient case and quietly accepted the persistent one.** After three
// retries it gave up with no way to say so, landing on exactly the blank widget the paragraph
// above was written to prevent — on Home, the owner's most-used screen. `onExhausted` is that
// channel. It fires at most once per call, only when every attempt produced nothing and the
// caller has not been cancelled, so "still retrying" and "gave up" are distinguishable at the
// render site: before it fires, an absent value means in-flight.
export interface FetchWithRetryOptions {
  /**
   * Called once when all attempts have produced nothing. Never called after `isCancelled()`
   * returns true — an unmounted component has no state worth setting.
   */
  onExhausted?: () => void;
}

const MAX_ATTEMPTS = 3;

export function fetchWithRetry<T>(
  key: string,
  url: string,
  ttlSeconds: number,
  onData: (d: T) => void,
  isCancelled: () => boolean,
  attempt = 0,
  fetchFn: (key: string, url: string, ttlSeconds: number, onData: (d: T) => void) => Promise<boolean> = cachedFetch,
  opts: FetchWithRetryOptions = {},
): void {
  let responded = false;
  fetchFn(key, url, ttlSeconds, (d) => { responded = true; onData(d); })
    .catch(() => {})
    .finally(() => {
      if (isCancelled() || responded) return;
      if (attempt < MAX_ATTEMPTS) {
        setTimeout(() => {
          if (!isCancelled()) fetchWithRetry(key, url, ttlSeconds, onData, isCancelled, attempt + 1, fetchFn, opts);
        }, 2500 * (attempt + 1));
        return;
      }
      // Out of attempts, nothing painted, still mounted. The one moment a caller can honestly
      // tell the difference between a slow load and a failed one.
      opts.onExhausted?.();
    });
}
