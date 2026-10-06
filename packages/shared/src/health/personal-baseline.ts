// Personal baseline — the asymmetric EMA of a rolling mean and abs-deviation that
// ecore maintains per metric, with step size that anneals by baseline age. Ported
// faithfully from open_oura's `baseline_update_lt_mean_and_dev @ 0x1dad04`
// (`crates/oura-analysis/src/ported/baseline.rs`, pinned 2026-07-11) — see
// docs/algorithms/baselines.md upstream for the decompile source.
//
// Values are stored as real × 8 fixed-point (i16 in ecore; we use plain numbers).
// `sample` must be an integer (round before calling — matches ecore's i32 contract).
// Used for all six Oura BLE Phase 5 baselines (HRV, RHR, temperature, sleep, MET, breathing rate) —
// one Baseline per metric, updated once per accrued night, `ageDays` = nights of
// history so far (shared age counter across metrics, not independent per-metric ages).

export interface Baseline {
  meanX8: number
  devX8: number
}

/** Arithmetic shift right with round-toward-zero bias, matching the decompiled
 *  `(t < 0) ? (t + (2^s - 1)) >> s : t >> s`. */
function ashrRound(t: number, shift: number): number {
  const adj = t < 0 ? t + ((1 << shift) - 1) : t
  return adj >> shift
}

/** Update a baseline with a new (unscaled, integer) sample given the baseline age
 *  in nights. Step size anneals across three age bands (<4, 4-14, >14 nights): fast
 *  warm-up (mean gain 1/2), settling to ~1/32 once mature. `baseline` is null on the
 *  metric's first-ever sample. */
export function updateBaseline(baseline: Baseline | null, sample: number, ageDays: number): Baseline {
  let meanX8 = baseline?.meanX8 ?? 0
  let devX8 = baseline?.devX8 ?? 0
  const sampleX8 = sample << 3
  const delta = sampleX8 - meanX8

  if (ageDays > 14) {
    const bias = delta !== 0 && meanX8 <= sampleX8 ? 16 : -16
    meanX8 += ashrRound(delta + bias, 5)
  } else if (ageDays >= 4) {
    const bias = delta > 0 ? 4 : -4
    meanX8 += ashrRound(delta + bias, 3)
  } else {
    const t = delta > 0 ? delta + 1 : delta - 1
    meanX8 += ashrRound(t, 1)
  }

  // Deviation target = |sample - the just-updated mean|
  const absd = Math.abs(sampleX8 - meanX8)
  const [mag, shift]: [number, number] = ageDays > 14 ? [32, 6] : ageDays >= 4 ? [8, 4] : [4, 3]
  const bias2 = absd !== devX8 && devX8 <= absd ? mag : -mag
  devX8 += ashrRound(absd - devX8 + bias2, shift)

  return { meanX8, devX8 }
}

/** The vendor's mature dev gain is 1/64 (`shift 6`). From this age a running mean would weight a new
 *  night no more than the vendor update does, so `seedOrUpdateBaseline`'s dev warm-up hands over here. */
export const DEV_WARMUP_NIGHTS = 64

/**
 * `updateBaseline`, but the metric's FIRST-EVER sample seeds the baseline instead of annealing
 * toward it from zero. **This is what our folds should call. `updateBaseline` is the vendor port
 * and must not grow this behaviour** — its zero start is ecore's own ground truth, pinned by the
 * `warm_up_then_settle` vector in the test file next door, and changing it would make the port a
 * lie about what the ring does.
 *
 * BF-13. `updateBaseline(null, sample, 0)` returns half the sample, and the step size collapses to
 * 1/32 after 14 nights — so the mean is still climbing toward reality fifty nights later. Measured
 * on the owner's temperature history: night 2 read **17.905 °C** against a 35.81 °C sample (exactly
 * sample/2), and at night 50 the baseline was **35.464** against a true **35.827** — 0.363 °C low,
 * or 2.8 nightly sd. That single number was failing four consumers at once: the readiness penalty
 * ladder, the illness radar's z, the "body temp elevated" deload card, and the chronic-stress fever
 * mask.
 *
 * Why ecore gets away with it: the ring accrues its baselines from the metric's first night and
 * never exposes one this young. Our folds cold-start from an arbitrary point in the history, so the
 * young-baseline case is ours, not the vendor's — which is why the fix belongs here.
 *
 * `devX8: 0` because one sample has no spread, and `baselineZ` returns null while it is 0.
 *
 * **The deviation is warmed up too (#2159), because seeding only the mean left the same defect in
 * the denominator.** Handed to the vendor update at 0, the dev climbs toward the spread under the
 * same collapsing gain (1/64 after night 14), so it reads 0.45σ at night 14 — where scoring starts
 * using z — 0.54σ at 30 and 0.64σ at 67, against the 0.78σ it settles at after ~200 nights.
 * Every young baseline's z ran 1.3–2× hot: the next night's mean |z| was 2.07 at night 14 where a
 * settled baseline gives ~1.0. That is the generic (no-ring) readiness path on every day, since its
 * 28-night fold is always young, and any cold replay of stored history.
 *
 * So for the first `DEV_WARMUP_NIGHTS`, the dev is the running mean of each night's spread from the
 * mean it is judged against — the pre-update mean, which is what `baselineZ` divides into on the
 * next read. The first spread observed replaces the zero outright, so a metric that joins later than
 * the shared age counter (breathing did) is not anchored to zero by a large `ageDays`. From
 * `DEV_WARMUP_NIGHTS` on, the vendor update runs untouched. The mean is the vendor's throughout.
 * Measured on synthetic nightly series at each metric's real spread, the next night's mean |z| is
 * ~1.0 from night 8. MET, whose ×10 sample unit is ~0.9σ, lands a little under 1 instead of at 2.
 */
export function seedOrUpdateBaseline(baseline: Baseline | null, sample: number, ageDays: number): Baseline {
  if (baseline == null) return { meanX8: sample << 3, devX8: 0 }
  const next = updateBaseline(baseline, sample, ageDays)
  if (ageDays >= DEV_WARMUP_NIGHTS) return next
  const spreadX8 = Math.abs((sample << 3) - baseline.meanX8)
  const devX8 = baseline.devX8 === 0
    ? spreadX8
    : baseline.devX8 + (spreadX8 - baseline.devX8) / Math.max(ageDays, 1)
  // Integer, like the vendor state and the `*_dev_x8` columns: a fractional in-memory dev would
  // differ from the persisted checkpoint, and a windowed fold resumed from it would stop matching a
  // full replay.
  return { meanX8: next.meanX8, devX8: Math.round(devX8) }
}

/** Mean in real units. */
export function baselineMean(b: Baseline): number {
  return b.meanX8 / 8
}

/** Abs-deviation in real units. */
export function baselineDeviation(b: Baseline): number {
  return b.devX8 / 8
}

/** Normalized deviation of `sample` from the baseline mean. `null` until the
 *  deviation has accumulated (matches ecore: a fresh/single-sample baseline has no
 *  usable spread yet). */
export function baselineZ(b: Baseline, sample: number): number | null {
  if (b.devX8 === 0) return null
  return (sample - baselineMean(b)) / baselineDeviation(b)
}
