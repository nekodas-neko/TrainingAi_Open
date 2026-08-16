import { z } from 'zod'
import { RESTING_HR_MIN, RESTING_HR_MAX, HRV_MS_MAX } from './body-metrics'

/**
 * Bounds for the device-computed nightly summary pushed from the phone (Q-24 §4).
 *
 * These are *analysis outputs*, which is what makes them worth bounding: the six rolling EMA
 * baselines and their shared `n_history` age counter are carried forward night to night and drive
 * every baseline-relative readiness and illness contributor. A single poisoned push does not show
 * up as one bad day — it sets the state that the next weeks of scores are measured against.
 *
 * Bounds reject the physically impossible, not a bad night, and reuse the constants the codebase
 * already agreed on (`RESTING_HR_*`, `HRV_MS_MAX`) rather than restating them. Where a value is
 * genuinely open-ended it is left unbounded rather than given an invented ceiling.
 */

const HOURS_IN_DAY = 24
/** MET: 1 is sitting still, ~23 is a world-class sprint. */
const MET_MAX = 25
/** Respiration: a resting adult is 12-20; the ceiling is well past any real reading. */
const BREATH_RPM_MAX = 60
/** The ring reports ambient-range temperatures as well as skin-range ones (ops doc §4). */
const TEMP_C_MIN = 0
const TEMP_C_MAX = 60
const TEMP_DEV_C_ABS = 20

const optNum = (min: number, max: number) => z.number().finite().min(min).max(max).nullish()
const optInt = (min: number, max: number) => z.number().finite().int().min(min).max(max).nullish()

/**
 * A baseline is ×8 fixed-point of its metric, so its ceiling is the metric's ceiling ×8. Derived
 * rather than picked, so a widened metric bound can't silently leave the baseline bound behind.
 */
const X8 = 8
const baselinePair = (metricMax: number) => ({
  mean: optInt(-metricMax * X8, metricMax * X8),
  dev:  optInt(0, metricMax * X8),
})

const hrv = baselinePair(HRV_MS_MAX)
const rhr = baselinePair(RESTING_HR_MAX)
const temp = baselinePair(TEMP_C_MAX)
const sleep = baselinePair(HOURS_IN_DAY)
const met = baselinePair(MET_MAX)
const breath = baselinePair(BREATH_RPM_MAX)

export const OuraDailySummaryPushSchema = z.object({
  sleepDurationHours: optNum(0, HOURS_IN_DAY),
  sleepEfficiency:    optNum(0, 100),
  deepSleepHours:     optNum(0, HOURS_IN_DAY),
  remSleepHours:      optNum(0, HOURS_IN_DAY),
  restlessPeriods:    optInt(0, 1000),
  sleepLatencySec:    optInt(0, HOURS_IN_DAY * 3600),
  hrvAvgMs:           optNum(0, HRV_MS_MAX),
  rhrLowBpm:          optNum(RESTING_HR_MIN, RESTING_HR_MAX),
  rhrAvgBpm:          optNum(RESTING_HR_MIN, RESTING_HR_MAX),
  recoveryIndexHours: optNum(0, HOURS_IN_DAY),
  tempMeanC:          optNum(TEMP_C_MIN, TEMP_C_MAX),
  tempDevC:           optNum(-TEMP_DEV_C_ABS, TEMP_DEV_C_ABS),
  metAvg:             optNum(0, MET_MAX),
  breathAvgRpm:       optNum(0, BREATH_RPM_MAX),

  hrvBaselineMeanX8:    hrv.mean,   hrvBaselineDevX8:    hrv.dev,
  rhrBaselineMeanX8:    rhr.mean,   rhrBaselineDevX8:    rhr.dev,
  tempBaselineMeanX8:   temp.mean,  tempBaselineDevX8:   temp.dev,
  sleepBaselineMeanX8:  sleep.mean, sleepBaselineDevX8:  sleep.dev,
  metBaselineMeanX8:    met.mean,   metBaselineDevX8:    met.dev,
  breathBaselineMeanX8: breath.mean, breathBaselineDevX8: breath.dev,

  // The shared age counter across all six baselines. It only ever counts nights, so a negative
  // or absurd value is corrupt — and it gates baseline maturity, so a large one prematurely
  // un-gates every derived deviation (the Q-6 failure mode, reached from the other direction).
  nHistory: optInt(0, 100_000),
}).passthrough()

/**
 * Bounds for the device-computed *scored* layer (`oura_daily_derived`, Q-24 §4).
 *
 * Only the fields whose range is definitional are bounded here — a score is 0-100 because the
 * scale says so, minutes in a day cannot exceed 1440, an hour count cannot exceed 24. The
 * open-ended research metrics (`vascularAge`, `pwv`, the resilience family, `bdiDerived`) are
 * deliberately left unbounded: their plausible ranges are not settled anywhere in the codebase,
 * and inventing a ceiling risks rejecting a legitimate value, which for an analysis output is
 * worse than accepting an odd one. Bound them when their producers pin a range.
 */
const MINUTES_IN_DAY = 1440
const score = () => optInt(0, 100)

export const OuraDailyDerivedPushSchema = z.object({
  sleepScore:      score(),
  readinessScore:  score(),
  activityScore:   score(),
  illnessScore:    score(),
  chronicStressScore: score(),

  activeCaloriesEst:   optInt(0, 30_000),
  recoveryIndexHours:  optNum(0, HOURS_IN_DAY),
  wornHoursBle:        optNum(0, HOURS_IN_DAY),
  nightHrvBaselineMs:  optNum(0, HRV_MS_MAX),
  stressHighMinutes:   optInt(0, MINUTES_IN_DAY),
  recoveryHighMinutes: optInt(0, MINUTES_IN_DAY),
  daytimeStressScaled: optNum(-1000, 1000),
  trainingLoadOts:     optNum(0, 10_000),
}).passthrough()
