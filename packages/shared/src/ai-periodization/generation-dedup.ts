// Generic in-flight + short-cooldown dedup for an expensive idempotent async call
// (B3 — collapse the redundant prescription generations the ai_call_log double-trip
// panel surfaced). Deterministic: it never changes the *content* a call produces,
// only whether an identical call is re-run within the window.
export interface DedupCache<T> {
  run(
    key: string,
    opts: {
      // Skip the read-through cooldown for this call (still shares in-flight dedup).
      // Used by callers that must always re-run — e.g. a path that produces a *different*
      // result for the same key by design.
      skipCooldown?: boolean
      // Only successful results are worth reusing; a failure should be immediately retryable.
      cacheable: (result: T) => boolean
    },
    fn: () => Promise<T>,
  ): Promise<T>
}

export function createDedupCache<T>(cooldownMs: number): DedupCache<T> {
  const inFlight = new Map<string, Promise<T>>()
  const recent = new Map<string, { at: number; result: T }>()

  function pruneExpired(now: number) {
    for (const [k, v] of recent) {
      if (now - v.at >= cooldownMs) recent.delete(k)
    }
  }

  return {
    async run(key, opts, fn) {
      if (!opts.skipCooldown) {
        const cached = recent.get(key)
        if (cached && Date.now() - cached.at < cooldownMs) return cached.result
      }

      const inflight = inFlight.get(key)
      if (inflight) return inflight

      const promise = fn()
      inFlight.set(key, promise)
      try {
        const result = await promise
        if (opts.cacheable(result)) {
          const now = Date.now()
          pruneExpired(now)
          recent.set(key, { at: now, result })
        }
        return result
      } finally {
        inFlight.delete(key)
      }
    },
  }
}
