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
