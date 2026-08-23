import { pushMutations } from './sync-engine'

/**
 * Push, then revalidate — the ordering a local write needs, in one place (LB-4).
 *
 * A local write has to invalidate **twice**, and the pair is easy to get wrong in a way nothing
 * catches. Invalidating only *before* the push is the bug this exists to stop: every
 * `useCachedValue` subscriber wakes on that signal, refetches while the server still holds the
 * pre-write state, and **re-caches the stale payload** — which then stands for the key's full TTL
 * because nothing invalidates again. Home's Energy Balance card read 42 kcal high for exactly this
 * reason, one unlogged entry, while the screen that had logged it looked right because it appended
 * optimistically and never consulted the cache.
 *
 * Invalidating only *after* is worse: `pushMutations` never resolves usefully with no network, so
 * an offline write would repaint nothing at all — and offline-first is the point.
 *
 * So: the caller invalidates immediately, for its own screens, and hands the same invalidator here
 * to run again once the server actually has the write.
 *
 * **Only on a push that moved something.** `null` means nothing reached the server (no store, 5xx
 * backoff, every request failed) and `pushed: 0` means there was nothing to send — revalidating in
 * either case re-caches the same stale payload the caller is trying to get rid of.
 *
 * Fire-and-forget by design: the caller has already painted, and a rejected push is the outbox's
 * problem, not the caller's.
 *
 * Its own module rather than a function inside `sync-engine.ts` for one practical reason: a helper
 * that calls `pushMutations` through the module's *local* binding cannot have that call stubbed,
 * so the ordering — the entire fix — would be untestable. Importing it across a module boundary is
 * what makes the mock reach it.
 */
export function pushThenRevalidate(userId: string, revalidate: () => unknown): void {
  void pushMutations(userId)
    .then(res => { if (res && res.pushed > 0) return revalidate() })
    .catch(() => {});
}
