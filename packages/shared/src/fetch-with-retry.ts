import { cachedFetch } from "@/lib/sqlite/cache";

// cachedFetch surfaces data only on a cache hit or a 200 response; a 429/network blip on a
// fresh remount (e.g. right after activating a new program) silently yields nothing and never
// retries, leaving the readiness/sleep widgets blank until the app is restarted. This wraps a
// cachedFetch (or cachedFetchToday, for the today-guarded keys — pass it as `fetchFn`) with a
// few bounded retries when neither cache nor a successful fetch produced a response, so a
// transient failure self-heals instead of requiring a restart.
export function fetchWithRetry<T>(
  key: string,
  url: string,
  ttlSeconds: number,
  onData: (d: T) => void,
  isCancelled: () => boolean,
  attempt = 0,
  fetchFn: (key: string, url: string, ttlSeconds: number, onData: (d: T) => void) => Promise<boolean> = cachedFetch,
): void {
  let responded = false;
  fetchFn(key, url, ttlSeconds, (d) => { responded = true; onData(d); })
    .catch(() => {})
    .finally(() => {
      if (!isCancelled() && !responded && attempt < 3) {
        setTimeout(() => {
          if (!isCancelled()) fetchWithRetry(key, url, ttlSeconds, onData, isCancelled, attempt + 1, fetchFn);
        }, 2500 * (attempt + 1));
      }
    });
}
