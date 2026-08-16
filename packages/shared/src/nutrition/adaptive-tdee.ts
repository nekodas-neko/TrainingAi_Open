// Calibrated maintenance — what this user's body actually burns, learned from data.
//
// The formula estimate (Mifflin-St Jeor × activity factor) is a population average and is
// routinely 200-400 kcal off for an individual. Given paired daily intake and body weight over
// a window, the real number falls out of energy balance:
//
//   maintenance = mean_intake − (Δweight_kg × KCAL_PER_KG / days)
//
// If you ate 2000/day and lost 0.5 kg over 14 days, you burned 2000 + (0.5 × 7700 / 14) = 2275.
// The sign convention: losing weight (negative slope) means you burned MORE than you ate.
//
// ── Why this is gated hard ────────────────────────────────────────────────────────────────────
// The estimate is only as good as the intake log. A window with half the days unlogged reads as
// a huge deficit and would tell the user their maintenance is 1200 kcal — actively harmful
// advice. So an un-gated number is never returned: `maintenanceKcal` is null unless the window
// clears every threshold below, and `excludedReason` says which one failed.

import { linearFit } from '../health/strength-projection'
import { KCAL_PER_KG } from './tdee-adaptation'

/** Days of history the estimator looks back over. Shorter windows are dominated by water-weight
 *  swings (a single salty meal moves scale weight ~1 kg, which is 7700 kcal of apparent error). */
export const DEFAULT_WINDOW_DAYS = 14

/** Widest window used when the short one lacks coverage — more days, more noise cancellation. */
export const MAX_WINDOW_DAYS = 28

/** Minimum days in the window that must carry a food log. Below this the mean intake is not
 *  representative and the weight change gets attributed to calories that were simply never typed in. */
export const MIN_LOGGED_DAYS = 10

/** Minimum weigh-ins needed to fit a weight slope at all. */
export const MIN_WEIGH_INS = 4

/** The weigh-ins must span at least this many days, or the slope is fitted to noise. */
export const MIN_WEIGHT_SPAN_DAYS = 10

/** Fraction of window days that must be logged for the estimate to be trusted. Guards the case
 *  where a 28-day window clears MIN_LOGGED_DAYS on 10 days but 18 days are missing. */
export const MIN_LOGGED_FRACTION = 0.7

/** Sanity clamp — a human maintenance outside this is an artefact of bad data, not a metabolism. */
export const MIN_PLAUSIBLE_MAINTENANCE = 1000
export const MAX_PLAUSIBLE_MAINTENANCE = 6000

export interface MaintenanceDay {
  date: string
  /** kcal eaten that day; null when nothing was logged (NOT zero — a zero would poison the mean). */
  intakeKcal: number | null
  /** Body weight that day; null when not weighed. */
  weightKg: number | null
}

export type MaintenanceExclusion =
  | 'not_enough_logged_days'
  | 'logging_too_sparse'
  | 'not_enough_weigh_ins'
  | 'weight_span_too_short'
  | 'implausible_result'

export interface MaintenanceEstimate {
  /** Calibrated maintenance kcal/day, or null when the window did not clear the gates. */
  maintenanceKcal: number | null
  /** 'high' at full coverage over the long window, 'medium' at the short window, 'low' at the floor. */
  confidence: 'low' | 'medium' | 'high' | null
  daysInWindow: number
  daysLogged: number
  meanIntakeKcal: number | null
  weightRateKgPerWeek: number | null
  weighIns: number
  weightSpanDays: number
  /** Set exactly when maintenanceKcal is null — which gate failed. */
  excludedReason: MaintenanceExclusion | null
}

/**
 * Estimate maintenance from a window of paired intake/weight days.
 *
 * `days` may be in any order and may contain gaps; only the trailing `windowDays` by date are
 * used. Days with `intakeKcal: null` are excluded from the mean but still count toward the
 * window length, so sparse logging correctly reads as sparse rather than as a deficit.
 */
export function estimateMaintenance(
  days: MaintenanceDay[],
  windowDays: number = DEFAULT_WINDOW_DAYS,
): MaintenanceEstimate {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date)).slice(-windowDays)

  const logged = sorted.filter(d => d.intakeKcal != null && d.intakeKcal > 0)
  const weighed = sorted.filter(d => d.weightKg != null && d.weightKg > 0)

  const meanIntakeKcal = logged.length > 0
    ? Math.round(logged.reduce((s, d) => s + d.intakeKcal!, 0) / logged.length)
    : null

  // Slope is fitted against the weigh-in's day index within the window, not its position in the
  // weighed array — an unevenly spaced series (weighed Mon, Tue, then Sunday) would otherwise
  // report a slope per-reading and badly overstate the rate.
  const dayIndex = new Map(sorted.map((d, i) => [d.date, i]))
  const fit = weighed.length >= 2
    ? linearFit(weighed.map(d => ({ x: dayIndex.get(d.date)!, y: d.weightKg! })))
    : null
  const slopeKgPerDay = fit?.slope ?? null
  const weightRateKgPerWeek = slopeKgPerDay != null
    ? Math.round(slopeKgPerDay * 7 * 100) / 100
    : null

  const weightSpanDays = weighed.length >= 2
    ? dayIndex.get(weighed[weighed.length - 1].date)! - dayIndex.get(weighed[0].date)!
    : 0

  const base: Omit<MaintenanceEstimate, 'maintenanceKcal' | 'confidence' | 'excludedReason'> = {
    daysInWindow: sorted.length,
    daysLogged: logged.length,
    meanIntakeKcal,
    weightRateKgPerWeek,
    weighIns: weighed.length,
    weightSpanDays,
  }
  const fail = (excludedReason: MaintenanceExclusion): MaintenanceEstimate =>
    ({ ...base, maintenanceKcal: null, confidence: null, excludedReason })

  if (logged.length < MIN_LOGGED_DAYS) return fail('not_enough_logged_days')
  if (logged.length / sorted.length < MIN_LOGGED_FRACTION) return fail('logging_too_sparse')
  if (weighed.length < MIN_WEIGH_INS) return fail('not_enough_weigh_ins')
  if (weightSpanDays < MIN_WEIGHT_SPAN_DAYS) return fail('weight_span_too_short')

  // Losing weight (negative slope) means expenditure exceeded intake — hence the minus.
  const maintenanceKcal = Math.round(meanIntakeKcal! - (slopeKgPerDay! * KCAL_PER_KG))
  if (maintenanceKcal < MIN_PLAUSIBLE_MAINTENANCE || maintenanceKcal > MAX_PLAUSIBLE_MAINTENANCE) {
    return fail('implausible_result')
  }

  const coverage = logged.length / sorted.length
  const confidence = sorted.length >= MAX_WINDOW_DAYS && coverage >= 0.9 ? 'high'
    : coverage >= 0.85 ? 'medium'
    : 'low'

  return { ...base, maintenanceKcal, confidence, excludedReason: null }
}

/**
 * Best available maintenance: the calibrated number when the data supports it, else the
 * formula baseline. Tries the long window first (more noise cancellation) and falls back to
 * the short one, so a user who has logged for 28 days gets the better estimate automatically.
 */
export function resolveMaintenance(
  days: MaintenanceDay[],
  formulaBaselineKcal: number,
): { maintenanceKcal: number; source: 'calibrated' | 'formula'; estimate: MaintenanceEstimate } {
  const long = estimateMaintenance(days, MAX_WINDOW_DAYS)
  if (long.maintenanceKcal != null) {
    return { maintenanceKcal: long.maintenanceKcal, source: 'calibrated', estimate: long }
  }
  const short = estimateMaintenance(days, DEFAULT_WINDOW_DAYS)
  if (short.maintenanceKcal != null) {
    return { maintenanceKcal: short.maintenanceKcal, source: 'calibrated', estimate: short }
  }
  // Report the window the user is closest to filling, so the UI can say "4 more days".
  return { maintenanceKcal: formulaBaselineKcal, source: 'formula', estimate: short }
}

/** Human-readable reason the calibration isn't ready yet. */
export function maintenanceGapMessage(e: MaintenanceEstimate): string {
  switch (e.excludedReason) {
    case 'not_enough_logged_days':
      return `Log food on ${MIN_LOGGED_DAYS - e.daysLogged} more day${MIN_LOGGED_DAYS - e.daysLogged === 1 ? '' : 's'} to calibrate`
    case 'logging_too_sparse':
      return 'Too many unlogged days in the window to calibrate'
    case 'not_enough_weigh_ins':
      return `Weigh in on ${MIN_WEIGH_INS - e.weighIns} more day${MIN_WEIGH_INS - e.weighIns === 1 ? '' : 's'} to calibrate`
    case 'weight_span_too_short':
      return 'Weigh-ins need to span at least 10 days to calibrate'
    case 'implausible_result':
      return 'Calibration produced an implausible number — check for unlogged days'
    default:
      return 'Using the formula estimate'
  }
}
