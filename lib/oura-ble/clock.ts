/**
 * Ring-clock ↔ wall-clock conversion from a set of anchor **observations**.
 *
 * The ring emits a monotonic deciseconds counter since its own epoch, never a wall-clock
 * time. Converting it needs at least one observed correspondence `(ringDs ↔ utc)`. Until
 * migration 161 the database held exactly one such row per user, mutated forward on every
 * ingest, and it was applied to every ds in history. A single anchor does not *stretch*
 * time — the two clocks both tick at ~1 s/s — but it does **offset every timestamp by that
 * one row's lag**: the gap between when the newest drained event actually happened and when
 * it reached the server. That lag is a whole drain interval at best and hours at worst, it
 * changes every time the anchor moves, and because `dayForDs` derives the local day from
 * this conversion, it slides historical day boundaries around underneath the steps rollup.
 *
 * So anchors are observations, not a setting. Keep them all; resolve each ds against the
 * observation nearest it rather than the most recent one, which bounds the error to one
 * drain interval instead of "time since the last sync".
 */

/** One observed `(ringDs ↔ wall clock)` correspondence. */
export interface ClockAnchor {
  epoch: number
  anchorDs: number
  /** Epoch milliseconds. */
  anchorUtcMs: number
}

/** Slope is fixed: one decisecond is 100 ms on both clocks. */
const MS_PER_DS = 100

/**
 * A ring counter that goes *backwards* is the only unambiguous evidence of a reset (re-key
 * or dead battery). Batches do arrive slightly out of order, though, so a small regression
 * is noise rather than a new epoch. One hour of deciseconds is far beyond any observed
 * reordering and far below any real reset, which drops the counter to near zero.
 */
export const EPOCH_REGRESSION_TOLERANCE_DS = 36_000

/** True when `batchMaxDs` is low enough against the epoch's high-water mark to mean a reset. */
export function isClockEpochReset(batchMaxDs: number, epochMaxDs: number): boolean {
  return batchMaxDs < epochMaxDs - EPOCH_REGRESSION_TOLERANCE_DS
}

/**
 * The epoch currently being extended — the one "now" is in.
 *
 * There is deliberately no `epochForDs`. After a reset the counter starts low again, so
 * different epochs cover overlapping ds ranges and a bare ds is *genuinely* ambiguous; any
 * function claiming to resolve it would be guessing. Historical samples carry their own
 * `epoch` column for exactly this reason. Callers holding only a ds (the accel and live-step
 * routes) are always talking about the present, and this is the honest answer for them.
 */
export function currentEpoch(anchors: ClockAnchor[]): number | null {
  if (anchors.length === 0) return null
  return anchors.reduce((m, a) => Math.max(m, a.epoch), anchors[0].epoch)
}

/**
 * An anchor's **lag** — how long the batch carrying it took to reach the server.
 *
 * `anchorUtcMs` is when the server received the batch; `anchorDs * 100` is when the ring
 * stamped its newest event. The difference is transport, not clock error.
 */
function lagMs(a: ClockAnchor): number {
  return a.anchorUtcMs - a.anchorDs * MS_PER_DS
}

/**
 * Robust floor of a lag distribution: the `LAG_PERCENTILE` order statistic, not the raw
 * minimum, so one glitched anchor cannot define the offset for a whole epoch.
 *
 * The floor is the right estimator because an event cannot be received before it happened —
 * lag is bounded below by the true offset and unbounded above by queueing. Measured on
 * production frames (2026-08-07, n=99): p0→p10 spans 1.4 min against a 56.2 min full spread,
 * so the lower edge is sharp and the tail is pure receive latency.
 */
const LAG_PERCENTILE = 0.1

function robustOffsetMs(anchors: ClockAnchor[]): number {
  const lags = anchors.map(lagMs).sort((a, b) => a - b)
  const idx = Math.min(lags.length - 1, Math.floor(lags.length * LAG_PERCENTILE))
  return lags[idx]
}

/**
 * Convert a ring `ds` to wall-clock epoch ms.
 *
 * Rules, in order:
 *  1. Restrict to observations from `epoch` (defaulting to the current one). A ds is never
 *     resolved across a reset — that is what made a reset silently fatal before.
 *  2. Apply the fixed 100 ms/ds slope with a single robust offset for the epoch.
 *  3. No observation in the epoch → `null`. Callers must handle a gap; silently computing a
 *     wrong time is worse than admitting there is no answer.
 *
 * **This deliberately does NOT interpolate between anchors (Q-139).** It used to, and the
 * slope it derived was `Δutc / Δds` — which is not a property of the clocks at all. While the
 * ring drains buffered history, ds advances far faster than the wall clock, so that ratio
 * collapses and ring time is compressed: measured on production frames, Δds 17,094 (28.5 min
 * of ring time) mapped onto 95 s of wall clock, an 18× squeeze. `resampleSteps` then folds
 * every squeezed window into the same 60 s block, which is how a block came to hold 1,555
 * steps — 26 steps per second.
 *
 * The ring's counter ticks at exactly 100 ms by construction, so the slope was never the
 * unknown; only the offset is. Estimating the offset alone removes the compression outright
 * and keeps the mapping monotonic in `ds`, which the interpolating version could not promise.
 *
 * The trade-off, stated so it is not rediscovered: a single offset per epoch ignores the
 * ring's own crystal drift across that epoch (seconds per day). That is the error this
 * accepts in exchange for removing an error measured in tens of minutes.
 */
export function resolveDsToMs(ds: number, anchors: ClockAnchor[], epoch?: number): number | null {
  const ep = epoch ?? currentEpoch(anchors)
  if (ep == null) return null
  const inEpoch = anchors.filter(a => a.epoch === ep)
  if (inEpoch.length === 0) return null

  return ds * MS_PER_DS + robustOffsetMs(inEpoch)
}

/**
 * Inverse of `resolveDsToMs` — wall clock back to a ring ds, for callers that only have a
 * phone timestamp but must store a ds-keyed value (`step_live_windows`, so the merge in
 * `lib/health/step-estimate.ts` stays in one domain).
 *
 * Symmetric with the forward direction: interpolate between the two observations bracketing
 * the instant, else extrapolate from the nearest.
 */
export function resolveMsToDs(utcMs: number, anchors: ClockAnchor[], epoch?: number): number | null {
  const ep = epoch ?? currentEpoch(anchors)
  if (ep == null) return null
  const inEpoch = anchors.filter(a => a.epoch === ep).sort((a, b) => a.anchorUtcMs - b.anchorUtcMs)
  if (inEpoch.length === 0) return null

  let before: ClockAnchor | null = null
  let after: ClockAnchor | null = null
  for (const a of inEpoch) {
    if (a.anchorUtcMs <= utcMs) before = a
    else { after = a; break }
  }

  if (before && after && after.anchorUtcMs > before.anchorUtcMs) {
    const t = (utcMs - before.anchorUtcMs) / (after.anchorUtcMs - before.anchorUtcMs)
    return before.anchorDs + t * (after.anchorDs - before.anchorDs)
  }
  const nearest = before ?? after!
  return nearest.anchorDs + (utcMs - nearest.anchorUtcMs) / MS_PER_DS
}
