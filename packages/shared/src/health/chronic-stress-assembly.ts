// Assembles the 27 `CumulativeStressInput` series for the most recent night from the BLE rollup's
// per-night summaries + stashed raw signals, then runs the golden-verified `runCumulativeStress`
// model. This is the entire risk surface of the chronic-stress feature (the model itself is
// pinned to a golden vector); every input→source mapping below is pinned per
// `docs/superpowers/plans/2026-07-18-cumulative-stress-wiring.md` §1.
//
// The five 30-day history series are each prior night's preprocessor "latest" output, recomputed
// in memory via `computeNightIntermediates` (plan §3B — no stored intermediate that could drift).
// The score is NaN (→ null at the call site) until ≥ 21 complete nights of granular signals exist
// in the window — the expected cold-start / learning state, not a failure.

import type { DailySummaryRow } from './daily-summary'
import {
  runCumulativeStress,
  computeNightIntermediates,
  type CumulativeStressInput,
  type CumulativeStressResult,
} from '@/lib/oura-models/cumulative-stress'

/** Trailing-window bound: the model needs 31 nights (30 history + latest). */
export const CHRONIC_STRESS_WINDOW = 31
/** Below this many complete nights the model cannot produce a score (its 21-day gate). */
export const CHRONIC_STRESS_MIN_DAYS = 21

// Conservative fever-deviation limit (degC). The model's fever mask is
// `(highestTemp > 38) || (tempDev > tempDevBaseline)`; `highestTemp > 38` is the unambiguous
// fever gate, and this secondary deviation limit is set high enough that a healthy night is never
// masked (over-masking would starve the 21-night gate → permanent NaN). Pending owner calibration
// against real worn history — recorded as a Known-Issue.
export const TEMP_DEV_FEVER_LIMIT_C = 1.0

/** Raw per-night signals stashed by the rollup loop (the granular data the model needs that isn't
 *  captured in `DailySummaryRow`). Keyed by wake-day in `signalsByDate`. */
export interface ChronicStressNightSignals {
  /** 30-second hypnogram, 1=deep 2=light 3=rem 4=awake (up-sampled 10× from the 5-min stager). */
  sleepPhase30Sec: number[]
  hrvItems: number[] // rMSSD samples (ms)
  hrvMedianHR5min: number[] // per-5-min median HR (bpm) — computeHrv5MinSeries
  hrvQuality5min: number[] // per-5-min valid-beat coverage (0–100)
  tempSkin: number[] // skin-temp samples across the night (degC)
  tempSkinTimestamps: number[] // unix ms, aligned with tempSkin ([-1] = missing)
  bedtimeStart: number // unix ms, -1 = missing
  highestTemperature: number // max skin temp over the night (degC), NaN if none
}

const num = (v: number | null | undefined): number => (v == null ? NaN : v)

/**
 * Compute the chronic-stress score + contributors for the most recent night in `summaryRows`
 * (ascending, oldest first). Returns the raw model result — the caller maps NaN → null and rounds
 * the score to the INTEGER column. Never throws (the model's error path returns all-NaN).
 */
export function computeChronicStress(
  summaryRows: DailySummaryRow[],
  signalsByDate: Map<string, ChronicStressNightSignals>,
): CumulativeStressResult | null {
  if (summaryRows.length === 0) return null
  const window = summaryRows.slice(-CHRONIC_STRESS_WINDOW)
  const latest = window[window.length - 1]
  const prior = window.slice(0, window.length - 1) // the ≤30 history nights (excludes latest)
  const latestSig = signalsByDate.get(latest.date)

  // 31-length series (aligned oldest→newest, latest last). highestTemperature comes from the raw
  // stash per night (not in DailySummaryRow); a night without raw signals contributes NaN.
  const gotUps = window.map((r) => num(r.restlessPeriods))
  const lowestHeartRate = window.map((r) => num(r.rhrLowBpm))
  const averageHrv = window.map((r) => num(r.hrvAvgMs))
  const restingHrAverage = window.map((r) => num(r.rhrAvgBpm))
  const longSleepHrv = window.map((r) => num(r.hrvAvgMs)) // one session/night — reuse nightly HRV
  const highestTemperature = window.map((r) => num(signalsByDate.get(r.date)?.highestTemperature))
  const temperatureDev = window.map((r) => num(r.tempDevC))
  const temperatureDevBaseline = window.map(() => TEMP_DEV_FEVER_LIMIT_C)
  const totalSleepDuration = window.map((r) => num(r.sleepDurationHours) * 3600)
  const cyclePhase = window.map(() => NaN) // no menstrual-cycle data (male user)

  // 30-length history series (prior nights only). averageMetMinutes pairs with fever_mask_30.
  const averageMetMinutes = prior.map((r) => num(r.metAvg))
  const interpretedCyclePhase = prior.map(() => NaN)

  const intermediates = prior.map((r) => {
    const sig = signalsByDate.get(r.date)
    if (!sig) {
      return {
        sleepFragmentationIndex: NaN,
        normHrvMedianHR5min: NaN,
        medianHrvQuality5min: NaN,
        normalisedIqr: NaN,
        normTempWake: NaN,
      }
    }
    return computeNightIntermediates({
      sleepPhase30Sec: sig.sleepPhase30Sec,
      hrvItems: sig.hrvItems,
      hrvMedianHR5min: sig.hrvMedianHR5min,
      hrvQuality5min: sig.hrvQuality5min,
      tempSkin: sig.tempSkin,
      tempSkinTimestamps: sig.tempSkinTimestamps,
      temperatureAvg: num(r.tempMeanC),
      bedtimeStart: sig.bedtimeStart,
      restingHrAvg: num(r.rhrAvgBpm),
      totalSleepDurationSec: num(r.sleepDurationHours) * 3600,
      highestTemperature: sig.highestTemperature,
      temperatureDev: num(r.tempDevC),
      temperatureDevBaseline: TEMP_DEV_FEVER_LIMIT_C,
    })
  })

  const input: CumulativeStressInput = {
    gotUps,
    lowestHeartRate,
    sleepPhase30Sec: latestSig?.sleepPhase30Sec ?? [],
    hrvItems: latestSig?.hrvItems ?? [],
    averageHrv,
    restingHrAverage,
    temperatureAvg: [num(latest.tempMeanC)],
    averageMetMinutes,
    longSleepHrv,
    hrvMedianHR5min: latestSig?.hrvMedianHR5min ?? [],
    hrvQuality5min: latestSig?.hrvQuality5min ?? [],
    tempSkin: latestSig?.tempSkin ?? [],
    sleepFragmentationIndex: intermediates.map((x) => x.sleepFragmentationIndex),
    normHrvMedianHR5min: intermediates.map((x) => x.normHrvMedianHR5min),
    medianHrvQuality5min: intermediates.map((x) => x.medianHrvQuality5min),
    normalisedIqr: intermediates.map((x) => x.normalisedIqr),
    normTempWake: intermediates.map((x) => x.normTempWake),
    highestTemperature,
    temperatureDev,
    temperatureDevBaseline,
    totalSleepDuration,
    nDaysToOvulation: [NaN],
    nDaysToPeriod: [NaN],
    cyclePhase,
    interpretedCyclePhase,
    bedtimeStart: [latestSig?.bedtimeStart ?? -1],
    tempSkinTimestamps: latestSig?.tempSkinTimestamps ?? [-1],
  }

  return runCumulativeStress(input)
}

/** Round the model score to the INTEGER column, mapping NaN/out-of-range → null. */
export function chronicStressScoreToInt(score: number): number | null {
  if (!Number.isFinite(score)) return null
  return Math.round(score)
}
