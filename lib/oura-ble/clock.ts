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
 * A ring counter that goes *backwards* is evidence that *something* happened. Batches do arrive
 * slightly out of order, so a small regression is noise. One hour of deciseconds is far beyond any
 * observed reordering.
 *
 * ⚠️ **A regression is NOT sufficient evidence of a reset, and treating it as such caused Q-536.**
 * See `isCounterRestart` below for what actually distinguishes the two, and
 * `classifyClockRegression` for the decision.
 */
export const EPOCH_REGRESSION_TOLERANCE_DS = 36_000

/** True when `batchMaxDs` regressed far enough below the epoch's high-water mark to be real rather
 *  than batch reordering. Says nothing about *why*. */
export function isClockEpochReset(batchMaxDs: number, epochMaxDs: number): boolean {
  return batchMaxDs < epochMaxDs - EPOCH_REGRESSION_TOLERANCE_DS
}

/**
 * How far below the epoch's high-water mark a batch must fall before the counter can be said to have
 * *restarted* rather than merely replayed.
 *
 * **This is the discriminator a bare regression lacks.** A re-drain replays history the ring already
 * sent, so its max ds is a large fraction of the epoch's ceiling — measured on both real events,
 * **53%** (17.4 M against 33.0 M) and **89%** (33.0 M against 37.1 M). A genuine re-key restarts the
 * ring's own clock at zero, so the first batch after one is a *small* fraction of a ceiling built
 * over months.
 *
 * A ratio rather than an absolute floor because it self-scales: on a ring re-keyed after two years
 * the ceiling is ~630 M ds, and 5% of that is still 36 days of fresh history before this stops
 * firing — where a fixed threshold would either be too small then or too large now.
 *
 * ⚠️ **There is no observed true reset in the data**, so this bound is validated only against the
 * two re-drains it must NOT fire on, where it has a 10× margin. It is a safety net for an
 * *undeclared* re-key; the declared path is the one that is supposed to carry the load.
 */
export const EPOCH_RESTART_RATIO = 0.05

/** True when the counter looks restarted-from-zero rather than replayed. */
export function isCounterRestart(batchMaxDs: number, epochMaxDs: number): boolean {
  if (!Number.isFinite(epochMaxDs) || epochMaxDs <= 0) return false
  return batchMaxDs < epochMaxDs * EPOCH_RESTART_RATIO
}

/**
 * What to do about a batch, given the epoch's high-water mark and whether a re-key was declared.
 *
 * **Q-314 — why this exists.** `isClockEpochReset` alone opened a new epoch on any regression over
 * an hour. After a re-pair the app holds no sync cursor, so the ring replays days of buffered
 * history — a 4.75-day regression on 2026-08-17 — and that read as a reset. It is not: the counter
 * is continuous across the boundary (18.6 s gap) and the minimum anchor lag agrees across all four
 * epochs to within 50 s.
 *
 * The cost of getting it wrong that way is not small. A spurious epoch becomes `currentEpoch`, and
 * its offset is estimated from a burst in which >90% of anchors carry re-drain backlog, so it lands
 * ~14 h out — and `aggregateOuraRawSamples` resolves every ds against `currentEpoch`, so **one
 * re-pair re-times the entire sleep history**. That happened twice (+12.17 h, then +14.16 h).
 *
 * The owner's decision (2026-08-17) is that a re-key is **declared**, not inferred: it is a
 * deliberate act performed with `open_oura` on a laptop, so the app can be told rather than left to
 * guess from counter shape. `isCounterRestart` remains as a net for an undeclared one, because
 * missing a real re-key is worse and quieter than the failure this replaces.
 */
export type ClockRegressionVerdict =
  /** Extend the current epoch. Either no regression, or one explained by a re-drain. */
  | { action: 'extend'; reason: 'in-sequence' | 'redrain' }
  /** Open the next epoch. */
  | { action: 'open-epoch'; reason: 'declared' | 'undeclared-restart' }

export function classifyClockRegression(
  batchMaxDs: number,
  epochMaxDs: number,
  rekeyDeclared: boolean,
): ClockRegressionVerdict {
  // A declaration wins outright, and deliberately does not require a regression at all: a ring
  // re-keyed mid-buffer can legitimately come back with a HIGHER ds than the old epoch's ceiling,
  // and requiring the counter to look restarted would silently ignore the owner saying it was.
  if (rekeyDeclared) return { action: 'open-epoch', reason: 'declared' }
  if (!isClockEpochReset(batchMaxDs, epochMaxDs)) return { action: 'extend', reason: 'in-sequence' }
  if (isCounterRestart(batchMaxDs, epochMaxDs)) return { action: 'open-epoch', reason: 'undeclared-restart' }
  return { action: 'extend', reason: 'redrain' }
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
