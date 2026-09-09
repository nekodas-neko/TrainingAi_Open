// Q-91-followup: wait for the server-side rollup to advance past a baseline, so a client that has
// seen a drain finish invalidates caches only once the derivation has actually landed.
//
// Kept free of `window`, `fetch` and the plugin so it is testable off-device — everything that
// touches the outside world arrives as a parameter. `getOuraBle()` returns null in the sandbox, so
// a helper that reached for any of it could not be exercised here at all.

export interface RollupState {
  lastRolledDs: number | null
  epoch: number | null
}

export interface WaitForRollupOptions {
  /** Reads `/api/oura-ble/rollup-state`. Returning null (a failed read) is treated as "no news". */
  read: () => Promise<RollupState | null>
  sleep: (ms: number) => Promise<void>
  /** The state read BEFORE the drain, or null if it could not be read. */
  baseline: RollupState | null
  /** Backoff schedule in ms. Its length is the attempt ceiling. */
  delaysMs?: readonly number[]
}

// Geometric-ish, capped: the rollup fires 3 s after the last batch and then takes as long as its
// span needs, so the early attempts are cheap and the tail is patient. Sums to ~46 s, which is the
// ceiling — a drain that carried nothing the rollup changes never advances the watermark, and that
// is the NORMAL case for a debug-only batch, not an error. Stopping quietly is the right end.
const DEFAULT_DELAYS_MS = [3_000, 3_000, 5_000, 5_000, 10_000, 10_000, 10_000] as const

/** Why the wait ended. `advanced` is the only one that means new derived data exists. */
export type RollupWaitOutcome = 'advanced' | 're-keyed' | 'timeout'

/**
 * Poll until the rollup watermark moves past `baseline`, or the schedule runs out.
 *
 * An epoch CHANGE short-circuits to `re-keyed`: the ring's deciseconds counter restarts from zero
 * on a re-key, so a numerically SMALLER `lastRolledDs` under a new epoch is progress, not a
 * regression. Comparing the counters across that boundary is meaningless — this is the same reason
 * `getOuraRollupWatermark` refuses to narrow against a stale epoch.
 */
export async function waitForRollup(opts: WaitForRollupOptions): Promise<RollupWaitOutcome> {
  const delays = opts.delaysMs ?? DEFAULT_DELAYS_MS
  const base = opts.baseline

  for (const delay of delays) {
    await opts.sleep(delay)
    const now = await opts.read()
    if (!now) continue // a failed read is not a verdict; keep the schedule

    if (base?.epoch != null && now.epoch != null && now.epoch !== base.epoch) return 're-keyed'

    if (now.lastRolledDs != null) {
      // No baseline (no successful rollup had ever run, or the pre-read failed) means any watermark
      // at all is news. Otherwise it has to have moved.
      if (base?.lastRolledDs == null || now.lastRolledDs > base.lastRolledDs) return 'advanced'
    }
  }
  return 'timeout'
}
