import { runSQL, querySQL, isSQLiteAvailable } from './sqlite-service';
import { todayInTz } from '@trainingai/shared/date-utils';
import { floorSeedTtl } from '@trainingai/shared/cache-ttl';

// ── sessionStorage mirror ────────────────────────────────────────────────────
// Every setCached call also writes a session-scoped copy so useLayoutEffect can
// read data synchronously before the first paint (async SQLite/localStorage reads
// always miss the first render frame).
const SS_PREFIX = 'ta_sscache:';

export function readCacheSync<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + key);
    if (raw) return JSON.parse(raw) as T;
    // Fallback to localStorage — persists across APK kills so first paint isn't blank
    return lsGet<T>(key);
  } catch { return null; }
}

/**
 * Sign-out latch. `clearAllCache()` alone does not hold: `cachedFetch` calls already in flight
 * resolve *after* it and re-seed the cache with the outgoing account's data. Measured on the real
 * sign-out (Q-172) — 4 of 17 keys came back, among them `weekly-stats` and `workout-data:meta`,
 * which carry no user id and so would paint for whoever signs in next.
 *
 * Tripped by `signOutAndClearDevice()` before it clears, and released when the sign-in screen
 * mounts — the one place a new session provably begins. Nothing else may touch it.
 */
let cacheWritesDisabled = false

export function disableCacheWrites(): void { cacheWritesDisabled = true }
export function enableCacheWrites(): void { cacheWritesDisabled = false }

// Exported so callers (e.g. SyncProvider's cache warmer) can populate the
// sessionStorage mirror for an existing cache hit without rewriting the
// persistent entry (and resetting its TTL).
export function mirrorToSessionCache<T>(key: string, data: T): void {
  if (cacheWritesDisabled) return;
  ssWrite(key, data);
}

function ssWrite<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(SS_PREFIX + key, JSON.stringify(data)); } catch { /* quota */ }
}

// ── localStorage fallback (web browser — SQLite is APK-only) ─────────────────
const LS_PREFIX = 'ta_cache:';

interface LsEntry<T> { data: T; expiresAt: number; cachedAt?: number }

function lsGetEntry<T>(key: string): LsEntry<T> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const entry: LsEntry<T> = JSON.parse(raw);
    if (entry.expiresAt < Date.now()) {
      localStorage.removeItem(LS_PREFIX + key);
      return null;
    }
    return entry;
  } catch { return null; }
}

function lsGet<T>(key: string): T | null {
  return lsGetEntry<T>(key)?.data ?? null;
}

function lsSet<T>(key: string, data: T, ttlSeconds: number): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: LsEntry<T> = {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
      // ttlSeconds here is already floored to 24h by setCached below, so this
      // entry can outlive its real TTL — cachedAt lets freshWithinTtl check
      // age against the *real* per-call ttlSeconds instead of this floor.
      cachedAt: Date.now(),
    };
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
  } catch { /* quota exceeded — silently skip */ }
}

function lsInvalidate(keyPrefix: string): void {
  if (typeof window === 'undefined') return;
  try {
    const fullPrefix = LS_PREFIX + keyPrefix;
    const toDelete = Object.keys(localStorage).filter(k => k.startsWith(fullPrefix));
    toDelete.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ── Invalidation subscribers ─────────────────────────────────────────────────
//
// Q-402. Invalidating a key and re-rendering the component that reads it are two different things,
// and until this existed the app only did the first. `lib/cache-groups.ts` clears `energy-balance:`
// from six write groups and the entry was correctly evicted every time — but Home's card seeds and
// fetches once in a `useEffect(…, [])`, lives in the persistent tab shell so it never unmounts, and
// therefore kept the first payload until the app was killed. The owner reported exactly that.
//
// This is the missing half: an invalidation now tells anyone who cares. `useCachedValue`
// (`lib/hooks/use-cached-value.ts`) is the consumer, and it is what a fetch-once hook should be
// built on rather than a hand-rolled effect.
//
// Deliberately a plain module-level Set rather than a `window` event: the cache module is the only
// thing that can invalidate, subscribers are in the same bundle, and a DOM event would need a
// server guard and would not fire in the node test environment where this is asserted.
type InvalidationListener = (keyPrefix: string) => void;
const invalidationListeners = new Set<InvalidationListener>();

/**
 * Be told when a cache key is invalidated. Returns an unsubscribe function.
 *
 * The argument is the **prefix** that was invalidated, because that is what `invalidateCache` takes;
 * a listener for `energy-balance:2026-08-19` must react to `energy-balance:`, so compare with
 * `startsWith` in whichever direction fits — `useCachedValue` does both, since a group may clear a
 * broader prefix than the key or the exact key itself.
 */
export function subscribeToInvalidation(listener: InvalidationListener): () => void {
  invalidationListeners.add(listener);
  return () => { invalidationListeners.delete(listener); };
}

function notifyInvalidated(keyPrefix: string): void {
  // A throwing listener must not stop the others, and must not turn a cache write into a failed
  // mutation — this runs on every write path in the app.
  for (const listener of invalidationListeners) {
    try { listener(keyPrefix); } catch (err) { console.error('Cache invalidation listener failed:', err); }
  }
}

// ── Cache API ────────────────────────────────────────────────────────────────

// In-flight fetch requests per key — prevents concurrent fetches for same cache key
const inFlightRequests = new Map<string, Promise<void>>();
// Callers that called cachedFetch while a request for the same key was already
// in flight — without this they'd return with only the (possibly null) cached
// value and never learn the fresh result the in-flight request eventually got.
// `onError`/`hadCached` mirror the owning call's failure rule (surface an error
// only when this particular caller had nothing cached to show instead) — a
// joiner's own cached state can differ from the owner's, however slightly.
interface PendingWaiter {
  onData: (data: unknown) => void;
  onError?: (info: CacheFetchErrorInfo) => void;
  hadCached: boolean;
}
const pendingWaiters = new Map<string, PendingWaiter[]>();

export async function getCached<T>(key: string): Promise<T | null> {
  if (isSQLiteAvailable()) {
    const rows = await querySQL<{ data: string; expires_at: string }>(
      'SELECT data, expires_at FROM api_cache WHERE key = ?',
      [key],
    );
    if (rows.length === 0) return null;
    if (new Date(rows[0].expires_at).getTime() < Date.now()) return null;
    try { return JSON.parse(rows[0].data) as T; } catch { return null; }
  }
  return lsGet<T>(key);
}

export async function setCached<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
  if (cacheWritesDisabled) return;  // sign-out in progress — see the latch above
  ssWrite(key, data);  // same-session reads (synchronous, before first paint)
  // Always write localStorage: it survives APK kills so readCacheSync can serve
  // instant data on relaunch, and floors the seed to OFFLINE_SEED_TTL_FLOOR (7d)
  // so a fully-offline device keeps painting last-known data. SWR handles
  // freshness whenever the network returns.
  lsSet(key, data, floorSeedTtl(ttlSeconds));

  if (isSQLiteAvailable()) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    try {
      await runSQL(
        `INSERT OR REPLACE INTO api_cache (key, data, cached_at, expires_at) VALUES (?, ?, ?, ?)`,
        [key, JSON.stringify(data), now.toISOString(), expiresAt],
      );
    } catch {
      // Same reasoning as invalidateCache below: this is a cache, not the source of truth, and
      // the localStorage mirror above already carries the seed. A write attempted before the DB
      // is open now throws (it used to no-op silently) and must not take a screen down with it.
    }
    return;
  }
  // web: lsSet above is the primary store — nothing more needed
}

// Read-mutate-write a single cached value in place, preserving its TTL. Used for
// optimistic paints (e.g. stamping today's completed workout into an already-cached
// summary) so the next read reflects the write without a full invalidate+refetch.
// No-ops if nothing is cached yet — an optimistic paint has nothing to upgrade, and
// the normal fetch will populate it fresh.
export async function updateCache<T>(key: string, ttlSeconds: number, fn: (data: T) => T): Promise<void> {
  const current = readCacheSync<T>(key);
  if (current === null) return;
  try {
    await setCached(key, fn(current), ttlSeconds);
  } catch { /* ignore — best-effort optimistic paint */ }
}

export async function invalidateCache(keyPrefix: string): Promise<void> {
  // Clear all sync mirrors so readCacheSync doesn't serve stale data after invalidation
  if (typeof window !== 'undefined') {
    const ssFullPrefix = SS_PREFIX + keyPrefix;
    Object.keys(sessionStorage).filter(k => k.startsWith(ssFullPrefix)).forEach(k => sessionStorage.removeItem(k));
  }
  lsInvalidate(keyPrefix);  // always clear localStorage mirror (now written on APK too)

  if (isSQLiteAvailable()) {
    try {
      await runSQL('DELETE FROM api_cache WHERE key LIKE ?', [`${keyPrefix}%`]);
    } catch {
      // SQLite unavailable or DB not open — localStorage was already cleared above
    }
  }

  // Last, so a listener that refetches cannot repopulate the key before the delete lands.
  notifyInvalidated(keyPrefix);
}

export async function clearAllCache(): Promise<void> {
  inFlightRequests.clear();
  if (typeof window !== 'undefined') {
    Object.keys(sessionStorage).filter(k => k.startsWith(SS_PREFIX)).forEach(k => sessionStorage.removeItem(k));
    Object.keys(localStorage).filter(k => k.startsWith('ta_')).forEach(k => localStorage.removeItem(k));
  }
  if (isSQLiteAvailable()) {
    try {
      await runSQL('DELETE FROM api_cache', []);
    } catch { /* cache-only; the localStorage/sessionStorage mirrors are already cleared */ }
    return;
  }
  // localStorage `ta_cache:*` already cleared above
}

// SQLite's `expires_at` already reflects the real per-call ttlSeconds (setCached
// never floors it there), so it's a direct freshness check. localStorage's
// `expiresAt` is floored to 24h regardless of ttlSeconds (see lsSet), so freshness
// there must be computed from `cachedAt` against the real ttlSeconds instead.
async function isFreshWithinTtl(key: string, ttlSeconds: number): Promise<boolean> {
  if (isSQLiteAvailable()) {
    const rows = await querySQL<{ cached_at: string }>(
      'SELECT cached_at FROM api_cache WHERE key = ?',
      [key],
    );
    if (rows.length === 0) return false;
    return new Date(rows[0].cached_at).getTime() + ttlSeconds * 1000 > Date.now();
  }
  const entry = lsGetEntry<unknown>(key);
  if (!entry?.cachedAt) return false;
  return entry.cachedAt + ttlSeconds * 1000 > Date.now();
}

// Shared stale-while-revalidate core for cachedFetch/cachedFetchToday. `toStored`/
// `fromStored` let a caller store a different shape than it delivers to `onData`
// (cachedFetchToday wraps/unwraps a `{date, data}` freshness envelope) while both
// variants share one in-flight-dedup + fan-out implementation.
// Failure channel (K2). Fires only when the network fetch failed AND no cached
// value was surfaced first — "cached-but-stale always beats an error state" (R3).
// `status` is the HTTP status for a non-ok response, or null for a network-level
// throw. Offline (navigator.onLine === false) is never reported: offline is not an
// error, it is the queue-and-show-saved-data UX.
export type CacheFetchErrorInfo = { status: number | null };

async function cachedFetchCore<T>(
  key: string,
  url: string,
  ttlSeconds: number,
  onData: (data: T) => void,
  toStored: (data: T) => unknown,
  fromStored: (stored: unknown) => T | null,
  freshWithinTtl?: boolean,
  onError?: (info: CacheFetchErrorInfo) => void,
): Promise<boolean> {
  // SQLite reads can throw on native if the DB is locked or in an error state.
  // Treat a failed cache read as a miss — proceed to the network fetch.
  let cached: T | null = null;
  try {
    const stored = await getCached<unknown>(key);
    if (stored !== null) cached = fromStored(stored);
  } catch {
    // cache read failed — proceed without cached data
  }
  if (cached !== null) {
    try { onData(cached); } catch { /* ignore — caller's onData threw */ }

    // Opt-in short-circuit: a write-group invalidation deletes the underlying
    // entry (all layers) before this runs, so `cached` can only be non-null and
    // fresh here if nothing invalidated it since it was written — skip the
    // redundant network round-trip entirely.
    if (freshWithinTtl) {
      try {
        if (await isFreshWithinTtl(key, ttlSeconds)) return true;
      } catch {
        // freshness check failed — fall through to the normal fetch path
      }
    }
  }

  // If a request is already in-flight for this key, join its waiter list instead
  // of firing a second fetch — every joiner still gets the fresh result, or the
  // failure, once the in-flight request resolves (previously only the original
  // caller's onData/onError fired, so a joiner with no cached data to fall back
  // on could see a 429/500 and never learn about it — the same silent-vanish
  // class Q-499 fixed at the component level, reachable here too whenever two
  // callers race for the same key, which React StrictMode's double effect-invoke
  // does on every render in dev).
  if (inFlightRequests.has(key)) {
    const waiters = pendingWaiters.get(key) ?? [];
    waiters.push({ onData: onData as (data: unknown) => void, onError, hadCached: cached !== null });
    pendingWaiters.set(key, waiters);
    try {
      await inFlightRequests.get(key);
    } catch {
      // In-flight request failed, but we already have cached data
    }
    return cached !== null;
  }

  // Create the fetch promise and store it
  const fetchPromise = (async () => {
    try {
      // `cache: 'no-store'` because the browser's HTTP cache is a SECOND cache layer under this
      // one, and it is the only cache in the app that `invalidateCache()` cannot reach. Aggregate
      // GET routes USED to ship `Cache-Control: private, max-age=60`, so without this the
      // revalidation half of stale-while-revalidate could be answered from that cache instead of
      // the network — and a write to a *different* URL than the read (DELETE
      // /api/supplements/<id> vs GET /api/supplements) does not invalidate it, so the deleted row
      // kept coming back for a minute. Measured, not assumed: with the default mode that
      // delete-then-list returned the removed row; under no-store it returned the correct list.
      //
      // Q-166 then took the routes themselves to `private, no-store`
      // (`scripts/check-api-no-store.js` keeps them there), so this is now the second of two
      // independent guarantees rather than the only one. Keep it: it is free, and it is the half
      // that holds for any response — including one from a route that regains a header.
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        // Got a response the server rejected (500/429/401/…) — the device is
        // online, so this is a real error. Only surface it when nothing was
        // painted from cache (stale data beats an error state) — per caller,
        // since a joined waiter's own cached state can differ from the owner's.
        const info: CacheFetchErrorInfo = { status: res.status };
        if (cached === null) { try { onError?.(info); } catch { /* caller's onError threw */ } }
        const waiters = pendingWaiters.get(key);
        if (waiters) {
          pendingWaiters.delete(key);
          for (const waiter of waiters) {
            if (waiter.hadCached) continue;
            try { waiter.onError?.(info); } catch { /* a joined caller's onError threw */ }
          }
        }
        return;
      }
      const data = await res.json() as T;
      onData(data);
      const waiters = pendingWaiters.get(key);
      if (waiters) {
        pendingWaiters.delete(key);
        for (const waiter of waiters) {
          try { waiter.onData(data); } catch { /* ignore — a joined caller's onData threw */ }
        }
      }
      await setCached(key, toStored(data), ttlSeconds);
    } catch {
      // Network-level throw. Offline is not an error (queue + show saved data);
      // only report a genuine failure while online with nothing cached to show.
      const online = cached === null && typeof navigator !== 'undefined' && navigator.onLine;
      if (online) { try { onError?.({ status: null }); } catch { /* caller's onError threw */ } }
      const waiters = pendingWaiters.get(key);
      if (waiters) {
        pendingWaiters.delete(key);
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          for (const waiter of waiters) {
            if (waiter.hadCached) continue;
            try { waiter.onError?.({ status: null }); } catch { /* a joined caller's onError threw */ }
          }
        }
      }
    } finally {
      pendingWaiters.delete(key);
    }
  })();

  inFlightRequests.set(key, fetchPromise);
  try {
    await fetchPromise;
  } finally {
    inFlightRequests.delete(key);
  }

  return cached !== null;
}

// Stale-while-revalidate: calls onData immediately with cached value (if fresh),
// then fetches the API, calls onData again with fresh data, and refreshes the cache.
// Returns true if the cache was hit (caller can skip showing a loading spinner).
// Uses per-key locking to prevent concurrent fetches for the same cache key.
//
// `opts.freshWithinTtl` skips the network fetch entirely when the cached entry
// is still within its real ttlSeconds — only safe for keys whose payload changes
// rarely and is invalidated by a write group (see lib/cache-groups.ts). Leave
// unset for anything relying on stale-while-revalidate to surface fresh data.
export async function cachedFetch<T>(
  key: string,
  url: string,
  ttlSeconds: number,
  onData: (data: T) => void,
  opts?: { freshWithinTtl?: boolean; onError?: (info: CacheFetchErrorInfo) => void },
): Promise<boolean> {
  return cachedFetchCore<T>(key, url, ttlSeconds, onData, d => d, s => s as T, opts?.freshWithinTtl, opts?.onError);
}

// { date, data } envelope for a cache key whose payload carries no date of its own
// (readiness-score, body-battery, training-load, weekly-stats, progress-summary,
// health-trends). Without this, a same-key entry that survives past local midnight
// (localStorage always keeps entries at least 24h, per setCached) reads back as a
// cache hit and silently renders yesterday's data before the network fetch lands.
interface TodayEnvelope<T> { date: string; data: T }

function unwrapToday<T>(stored: unknown): T | null {
  const envelope = stored as TodayEnvelope<T> | null;
  if (!envelope || envelope.date !== todayInTz()) return null;
  return envelope.data;
}

// Both guards below compare a date the SERVER stamped in the user's timezone against a
// date this client computes — so `tz` is not optional in spirit even though it is in the
// signature. Omit it and the comparison silently becomes "is the server's date equal to
// Brisbane's date", which is false for |Δ| hours out of every 24 for a user Δ hours from
// Brisbane: 14 hours a day in New York (Q-478). Pass `useUserTimezone()` from any
// component; the default keeps a Brisbane user's behaviour byte-for-byte unchanged.

// body-metadata carries its own freshness date at `today.date` rather than needing
// the generic {date, data} envelope above — shared guard so the fetch-hit `onData`
// callback (three call sites: session-select, health, nutrition) can't drift from
// the already-guarded synchronous seed reads. A payload with no `today` record at
// all (nothing logged yet) is not stale — only a `today` stamped with a past date is.
export function isBodyMetadataFresh(
  data: { today?: { date: string } | null } | null | undefined,
  tz?: string,
): boolean {
  return data?.today == null || data.today.date === todayInTz(tz);
}

// workout-data/workout-card payloads carry a server-stamped `dataDate`; the per-exercise
// `loggedTodayInSession` flag is only meaningful when that build date is today (the key is
// date-less + TTL_LONG, so a cached payload survives past midnight). A payload with no
// dataDate (older cache entry) is treated as not-today — the flag falls back to false.
export function isWorkoutDataToday(
  data: { dataDate?: string } | null | undefined,
  tz?: string,
): boolean {
  return data?.dataDate === todayInTz(tz);
}

// Sync seed read (mirrors readCacheSync) for a today-guarded key — used in the
// useLayoutEffect/useEffect seed at mount, before the first cachedFetchToday call.
export function readTodayCacheSync<T>(key: string): T | null {
  const stored = readCacheSync<unknown>(key);
  if (stored === null) return null;
  return unwrapToday<T>(stored);
}

// cachedFetch variant for the six date-less "today" keys — same stale-while-
// revalidate/in-flight-dedup behavior, but a stored entry from a previous day is
// always treated as a miss instead of momentarily flashing yesterday's data.
export async function cachedFetchToday<T>(
  key: string,
  url: string,
  ttlSeconds: number,
  onData: (data: T) => void,
  opts?: { onError?: (info: CacheFetchErrorInfo) => void },
): Promise<boolean> {
  return cachedFetchCore<T>(
    key, url, ttlSeconds, onData,
    (data): TodayEnvelope<T> => ({ date: todayInTz(), data }),
    unwrapToday<T>,
    undefined,
    opts?.onError,
  );
}
