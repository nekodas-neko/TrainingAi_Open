// Per-night daily summary + rolling personal baselines (Oura BLE Phase 5 addendum
// A3). Pure sequencing over pre-sorted nights: replays each metric's asymmetric-EMA
// baseline (lib/health/personal-baseline.ts) forward night by night, so the whole
// history is deterministically reproducible from source data — no stored counter
// can drift (nights are re-derived from oura_raw_samples on every rollup pass, same
// pattern as the sleep/HR-series rollup steps).

import { updateBaseline, type Baseline } from './personal-baseline'
import { temperatureDeviationCentiC } from './temperature-baseline'
import { BASELINE_MIN_NIGHTS } from './readiness-composite'

export interface NightInput {
  date: string
  sleepDurationHours: number | null
  sleepEfficiency: number | null
  deepSleepHours: number | null
  remSleepHours: number | null
  restlessPeriods: number | null
  sleepLatencySec: number | null
  hrvAvgMs: number | null
  rhrLowBpm: number | null
  rhrAvgBpm: number | null
  recoveryIndexHours: number | null
  /** Nightly skin temperature in degC (already divided down from the ported
   *  centi-degC algorithm — see temperature-baseline.ts). */
  tempMeanC: number | null
  metAvg: number | null
  /** Night median breaths/min — the SAME value the rollup stores on
   *  sleep_sessions.respiratory_rate (median of per-epoch breathingFromIbi rates). */
  breathAvgRpm: number | null
}

export interface DailySummaryRow extends NightInput {
  /** This night's temperature deviation from the baseline BEFORE this night's
   *  update — null until a temperature baseline exists (first temp night). */
  tempDevC: number | null
  hrvBaseline: Baseline | null
  rhrBaseline: Baseline | null
  tempBaseline: Baseline | null
  sleepBaseline: Baseline | null
  metBaseline: Baseline | null
  breathBaseline: Baseline | null
  /** Nights of history accrued so far, inclusive of this one — shared age counter
   *  across all six metrics, matching ecore's per-user (not per-metric) cadence. */
  nHistory: number
}

/** The complete EMA fold state as of some prior night — the six per-metric baselines plus the
 *  history count. A `DailySummaryRow` already carries exactly this state (its baseline fields are
 *  the fold state AFTER that night, and nHistory is the count inclusive of it), so the persisted
 *  summary row for the night before a window is a valid seed. Because each metric's baseline is a
 *  pure forward fold `(priorState, thisNight, ageDays) → nextState`, seeding from a checkpoint and
 *  folding only later nights produces byte-identical rows to a full replay — this is what lets the
 *  rollup process a bounded recent window without re-reading all history (review C-1/H-2). */
export interface DailySummarySeed {
  hrvBaseline: Baseline | null
  rhrBaseline: Baseline | null
  tempBaseline: Baseline | null
  sleepBaseline: Baseline | null
  metBaseline: Baseline | null
  breathBaseline: Baseline | null
  nHistory: number
}

/** `nights` must be pre-sorted ascending by date (oldest first) — the EMA baselines
 *  are inherently sequential and this function replays them in order. Pass `seed` to resume the
 *  fold from a persisted checkpoint (the summary row for the night before `nights[0]`); omit it to
 *  replay from a cold start (the full-history / new-user path). */
export function computeDailySummaries(nights: NightInput[], seed?: DailySummarySeed | null): DailySummaryRow[] {
  let hrvBaseline: Baseline | null = seed?.hrvBaseline ?? null
  let rhrBaseline: Baseline | null = seed?.rhrBaseline ?? null
  let tempBaseline: Baseline | null = seed?.tempBaseline ?? null
  let sleepBaseline: Baseline | null = seed?.sleepBaseline ?? null
  let metBaseline: Baseline | null = seed?.metBaseline ?? null
  let breathBaseline: Baseline | null = seed?.breathBaseline ?? null
  let nHistory = seed?.nHistory ?? 0

  const rows: DailySummaryRow[] = []
  for (const night of nights) {
    // Age is nights of history accrued BEFORE tonight — matches ecore's baseline
    // age semantics (a baseline's own first update is always at age 0).
    const ageDays = nHistory

    // Q-6: `updateBaseline` is a faithful ecore port that starts from meanX8 = 0, but our fold
    // cold-started rather than inheriting the ring's own accrued state — so the mean climbs from
    // zero and a deviation taken against it is nonsense until it has settled. Production read
    // temp_dev_c = +17.000 degC on the second night, and that number went verbatim into the AI
    // health-insight prompt and onto the day-log surface.
    //
    // Suppressed at the point of derivation rather than at each consumer: the illness radar and the
    // readiness composite already gate on the same BASELINE_MIN_NIGHTS, but temp_dev_c is persisted,
    // so any future reader would inherit the cold value unless it never gets written. Gating here
    // means there is nothing to miss. The port itself is untouched.
    //
    // Compared against the row's OWN nHistory (inclusive of tonight), which is the quantity the
    // radar gates on — so "n_history = 14" means mature in both places.
    const rowNHistory = nHistory + 1
    const tempDevC = night.tempMeanC != null && tempBaseline != null && rowNHistory >= BASELINE_MIN_NIGHTS
      ? temperatureDeviationCentiC(Math.round(night.tempMeanC * 100), tempBaseline.meanX8 / 8) / 100
      : null

    if (night.hrvAvgMs != null) hrvBaseline = updateBaseline(hrvBaseline, Math.round(night.hrvAvgMs), ageDays)
    if (night.rhrLowBpm != null) rhrBaseline = updateBaseline(rhrBaseline, Math.round(night.rhrLowBpm), ageDays)
    // Temperature baseline update is in centi-degC (matches the ported algorithm's
    // native units); sleep in minutes and MET ×10 for integer-sample resolution —
    // updateBaseline requires an integer sample (ecore's i32 contract).
    if (night.tempMeanC != null) tempBaseline = updateBaseline(tempBaseline, Math.round(night.tempMeanC * 100), ageDays)
    if (night.sleepDurationHours != null) sleepBaseline = updateBaseline(sleepBaseline, Math.round(night.sleepDurationHours * 60), ageDays)
    if (night.metAvg != null) metBaseline = updateBaseline(metBaseline, Math.round(night.metAvg * 10), ageDays)
    // Breathing in rpm×10 for integer-sample resolution (same trick as MET ×10) —
    // rateBrpm carries 0.1-rpm precision that a bare Math.round would destroy.
    if (night.breathAvgRpm != null) breathBaseline = updateBaseline(breathBaseline, Math.round(night.breathAvgRpm * 10), ageDays)

    nHistory += 1
    rows.push({
      ...night,
      tempDevC,
      hrvBaseline, rhrBaseline, tempBaseline, sleepBaseline, metBaseline, breathBaseline,
      nHistory,
    })
  }
  return rows
}
