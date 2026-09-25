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
/** Exported so the SQL that computes this same order statistic cannot drift from the JS
 *  (RV-182 ②) — one constant, two languages. */
export const LAG_PERCENTILE = 0.1

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
/**
 * Per-anchor-array memo of the two O(n) steps `resolveDsToMs` used to redo for every single row:
 * resolving the current epoch, and filtering-then-sorting that epoch's anchors for the offset.
 *
 * **Keyed on the array IDENTITY, deliberately.** Every caller reads its anchors once and passes the
 * same array for every row of a batch, so identity is precisely "this batch" — no key to build, and
 * nothing to invalidate. A `WeakMap` lets a finished request's entry be collected along with its
 * array instead of accumulating in a cache that nothing prunes.
 *
 * ⚠ It assumes the array is not mutated in place between calls. Every current caller builds one
 * from a query and treats it as read-only; a caller that appended to a live array would keep the
 * offset computed before the append. That is a comment rather than a defensive copy because copying
 * per row is the cost this exists to remove.
 *
 * RV-180: production holds **12,396 anchors**, all in epoch 0, growing 150–300 a day, and
 * `resolveDsToMs` is called once per row inside three `rows.map`s. Benchmarked at **3.0 ms a call**,
 * `device-metrics`' default 3-day window is 58,856 rows ≈ **177 s of synchronous CPU** on the single
 * Node process — which blocks every other request. That is the shape DV-13 saw: four admin requests
 * hanging past 90 s and `/api/version` timing out from another machine for 8 minutes.
 */
const clockMemo = new WeakMap<ClockAnchor[], { epoch: number | null; offsets: Map<number, number | null> }>()

function memoFor(anchors: ClockAnchor[]): { epoch: number | null; offsets: Map<number, number | null> } {
  let memo = clockMemo.get(anchors)
  if (!memo) {
    memo = { epoch: currentEpoch(anchors), offsets: new Map() }
    clockMemo.set(anchors, memo)
  }
  return memo
}

/** The epoch's robust offset, memoised per anchor array. **Both directions go through this**, which
 *  is what makes them exact inverses rather than two models that agree by accident (LA-141). */
function offsetForEpoch(anchors: ClockAnchor[], ep: number): number | null {
  const memo = memoFor(anchors)
  let offset = memo.offsets.get(ep)
  if (offset === undefined) {
    const inEpoch = anchors.filter(a => a.epoch === ep)
    // Null rather than absent, so an epoch with no anchors is remembered as answered — otherwise a
    // caller asking for the same empty epoch once per row pays the filter every time, which is the
    // cost being removed wearing a different hat.
    offset = inEpoch.length === 0 ? null : robustOffsetMs(inEpoch)
    memo.offsets.set(ep, offset)
  }
  return offset
}

/**
 * The resolved clock for a user: the current epoch, and each epoch's robust offset.
 *
 * **This, not the anchor rows, is all either direction actually needs** — which is the point.
 * `robustOffsetMs` reduces an epoch's anchors to one scalar, so a caller that only converts
 * timestamps can have that scalar computed in the database instead of dragging the whole
 * observation log into Node (RV-182 ②: 12,591 rows, 2,190 times, 9.4% of all database time).
 * Callers that need the observations themselves — the rollup reads `anchorDs` for its watermark —
 * keep taking `ClockAnchor[]`.
 */
export interface ClockOffsets {
  /** Max epoch present, or null when there are no anchors at all. */
  epoch: number | null
  /** Per-epoch offset in ms. A null VALUE means that epoch has no anchors; an absent key means
   *  it was never asked about. */
  offsets: Map<number, number | null>
}

/**
 * Reduce anchors to the same shape the database returns, for callers that already hold them.
 *
 * **Eagerly, one entry per epoch present** — deliberately, and not `memoFor` directly. That memo
 * fills lazily as `offsetForEpoch` is asked, so handing it out as a `ClockOffsets` gives a map that
 * is empty until something asks the anchor-based resolvers first, and the offset-based ones read
 * `undefined` and answer null. The database returns a row per epoch, so this does too.
 */
export function offsetsFromAnchors(anchors: ClockAnchor[]): ClockOffsets {
  const offsets = new Map<number, number | null>()
  for (const ep of new Set(anchors.map(a => a.epoch))) offsets.set(ep, offsetForEpoch(anchors, ep))
  return { epoch: currentEpoch(anchors), offsets }
}

/** `ds` → wall clock, from a resolved clock. See `resolveDsToMs` for the model and why it is
 *  a fixed slope with one offset rather than an interpolation. */
export function dsToMs(ds: number, clock: ClockOffsets, epoch?: number): number | null {
  const ep = epoch ?? clock.epoch
  if (ep == null) return null
  const offset = clock.offsets.get(ep)
  if (offset == null) return null
  return ds * MS_PER_DS + offset
}

/** Wall clock → `ds`, from a resolved clock. The exact inverse of `dsToMs` (LA-141). */
export function msToDs(utcMs: number, clock: ClockOffsets, epoch?: number): number | null {
  const ep = epoch ?? clock.epoch
  if (ep == null) return null
  const offset = clock.offsets.get(ep)
  if (offset == null) return null
  return (utcMs - offset) / MS_PER_DS
}

export function resolveDsToMs(ds: number, anchors: ClockAnchor[], epoch?: number): number | null {
  const ep = epoch ?? memoFor(anchors).epoch
  if (ep == null) return null
  const offset = offsetForEpoch(anchors, ep)
  if (offset == null) return null
  return ds * MS_PER_DS + offset
}

/**
 * Inverse of `resolveDsToMs` — wall clock back to a ring ds, for callers that only have a
 * phone timestamp but must store or query a ds-keyed value.
 *
 * **A true inverse, by construction: it is `resolveDsToMs` solved for `ds`, through the same
 * `offsetForEpoch`.** It is written that way because it previously was not, and said it was
 * (LA-141). It interpolated between the two anchors bracketing the instant, and its comment called
 * that *"symmetric with the forward direction"* — but the forward direction had stopped
 * interpolating in Q-139, precisely because the slope that derives, `Δutc / Δds`, is not a property
 * of either clock. While the ring drains buffered history, ds advances far faster than the wall
 * clock and that ratio collapses: Q-139 measured 17,094 ds (28.5 min of ring time) arriving in 95 s,
 * an 18x squeeze, which is how a 60 s step block came to hold 1,555 steps.
 *
 * So the two directions disagreed by the whole of that error. On Q-139's own drain shape a ds
 * round-tripped **16,144 ds — 26.9 minutes of ring time — away from itself**. And a burst of anchors
 * minted seconds apart while a backlog drains does not bracket anything meaningful, which a second
 * measurement confirmed independently over nine real nights: every one shifted 10-48 minutes later.
 *
 * The same trade-off the forward direction states applies here and is worth restating rather than
 * rediscovering: one offset per epoch ignores the ring's crystal drift across that epoch, seconds
 * per day. That is the error accepted in exchange for removing one measured in tens of minutes.
 */
export function resolveMsToDs(utcMs: number, anchors: ClockAnchor[], epoch?: number): number | null {
  const ep = epoch ?? memoFor(anchors).epoch
  if (ep == null) return null
  const offset = offsetForEpoch(anchors, ep)
  if (offset == null) return null
  return (utcMs - offset) / MS_PER_DS
}
