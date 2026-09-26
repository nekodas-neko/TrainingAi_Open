// The app's own verdict on last night, and the evidence behind it (TN-81).
//
// Design: docs/superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md. The app never asks
// how the night was — it decides, says so, and the owner's only interaction is to correct it when
// it is wrong. A correction is a disagreement, and a disagreement is the label the tuning models
// have never had.
//
// Two things make this honest, and both are requirements rather than preferences:
//
//  1. **The verdict is computed from components, not a composite.** The owner named the inputs
//     ("sleep was later; or short"), and a night of normal length that started two hours late is
//     strange in a way a composite averages away.
//  2. **The verdict and the values behind it are SNAPSHOTTED by the caller.** `sleep_score` is
//     computed on read and persisted nowhere — measured 2026-09-26, non-null on 0 of 119 rows in
//     the last 120 days. So if only the outcome were stored, a later scoring change would rewrite
//     what each correction had been disagreeing with, and the corrections would decay into noise
//     with no signal that it happened. A correction whose paired verdict is not pinned is not
//     evidence. This module therefore returns the bands and the component values, not just a word.
//
// It computes nothing about the owner's opinion and must never be mistaken for it: an auto-filled
// value writes `touched: false`, and only a correction writes `touched: true` (TN-57).

import { median, quantile } from '@trainingai/shared/health/daily-medians'
import { msToHHMMInTz, toAestDay, daysBetweenDateStrs, DEFAULT_TZ } from '@trainingai/shared/date-utils'

/**
 * Signed minutes from the wake date's local midnight at which sleep started, for `VerdictNight`.
 *
 * Both the clock reading and the calendar day are taken in the USER's timezone, never the
 * device's — a `toLocale*` without an explicit zone renders in whoever is looking, which is the
 * bug class that shifted six screens by ten hours. The sign comes from comparing the night's own
 * local date to the wake date, so a 23:10 start reads −50 rather than 1390 and "90 minutes later
 * than usual" is subtraction.
 */
export function onsetMinutesForNight(
  sleepStart: string | number | Date,
  wakeDate: string,
  tz: string = DEFAULT_TZ,
): number | null {
  const at = sleepStart instanceof Date ? sleepStart : new Date(sleepStart)
  if (Number.isNaN(at.getTime())) return null
  const [h, m] = msToHHMMInTz(at, tz).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m - daysBetweenDateStrs(toAestDay(at, tz), wakeDate) * 1440
}

/** Nights of history a component needs before it may judge anything. A window of 28 needs 28. */
export const VERDICT_BASELINE_NIGHTS = 28

/**
 * How far outside the interquartile range a value must sit to be called strange, as a multiple of
 * the IQR. Median and IQR rather than mean and sd because these distributions are bounded and
 * skewed, and because one bad night must not widen the band that judges the next one.
 *
 * A STARTING value, tuned toward 4–6 prominent announcements a month. The rate is the target and
 * this multiplier is only how it is reached — re-measure once real announcements have fired.
 */
export const VERDICT_IQR_MULTIPLIER = 0.5

/** Bumped whenever the verdict rule changes, so a stored snapshot says which rule produced it. */
export const SLEEP_VERDICT_MODEL_VERSION = 1

export type SleepVerdict = 'normal' | 'poor' | 'good'
export type SleepComponent = 'duration' | 'onset' | 'efficiency'

export const SLEEP_COMPONENTS: readonly SleepComponent[] = ['duration', 'onset', 'efficiency'] as const

/** One night, reduced to the three components the verdict reads. */
export interface VerdictNight {
  /** Wake-up date, `YYYY-MM-DD`, in the user's timezone. */
  date: string
  durationHours: number | null
  /**
   * Minutes from the user's local midnight at which sleep STARTED, negative before midnight
   * (23:10 → −50). Signed rather than 0–1439 so that "later than usual" is plain arithmetic
   * instead of wrapping across midnight — a 23:50 and a 00:10 onset are 20 minutes apart, and on
   * an unsigned clock they are 1,420.
   */
  onsetMinutes: number | null
  efficiency: number | null
}

export interface ComponentBand {
  median: number
  low: number
  high: number
  /** Nights that fed this component's band — never below VERDICT_BASELINE_NIGHTS. */
  nights: number
}

export interface SleepVerdictResult {
  verdict: SleepVerdict
  /** Which components were outside their band. Empty on a `normal` verdict. */
  triggered: SleepComponent[]
  /** Last night's values, as judged. Snapshot these. */
  components: Record<SleepComponent, number | null>
  /** The bands they were judged against. Snapshot these too — see the header. */
  bands: Partial<Record<SleepComponent, ComponentBand>>
  /** The largest per-component baseline used, for a one-number "how cold is this". */
  baselineNights: number
  modelVersion: number
}

const VALUE_OF: Record<SleepComponent, (n: VerdictNight) => number | null> = {
  duration: n => n.durationHours,
  onset: n => n.onsetMinutes,
  efficiency: n => n.efficiency,
}

/**
 * Which direction is bad for each component. `low` means a value BELOW the band is the poor one.
 *
 * Duration and efficiency are obvious. Onset is `high` because going to bed later than usual is
 * the strange direction the owner named; an unusually early night reads as good.
 */
const POOR_SIDE: Record<SleepComponent, 'low' | 'high'> = {
  duration: 'low',
  onset: 'high',
  efficiency: 'low',
}

function bandFor(values: number[]): ComponentBand | null {
  if (values.length < VERDICT_BASELINE_NIGHTS) return null
  const p25 = quantile(values, 0.25)
  const p75 = quantile(values, 0.75)
  const mid = median(values)
  if (p25 === null || p75 === null || mid === null) return null
  const iqr = p75 - p25
  return {
    median: mid,
    low: p25 - VERDICT_IQR_MULTIPLIER * iqr,
    high: p75 + VERDICT_IQR_MULTIPLIER * iqr,
    nights: values.length,
  }
}

/**
 * Judge `target` against the nights before it.
 *
 * `history` is every night available; nights on or after the target's date are ignored, so a night
 * never helps judge itself and a re-run over old data gives the same answer it gave at the time.
 * Only the most recent `VERDICT_BASELINE_NIGHTS` values PER COMPONENT are used, counted after
 * dropping nulls — coverage differs by component (measured 2026-09-26: duration 119/119,
 * efficiency 112/119), so an all-or-nothing gate would hold back components that are ready.
 *
 * Returns `null` when no component has a full window: there is nothing honest to announce off a
 * thin baseline, and silence is the correct output rather than a guess.
 */
export function sleepVerdictForNight(
  target: VerdictNight,
  history: readonly VerdictNight[],
): SleepVerdictResult | null {
  const priorDesc = history
    .filter(n => n.date < target.date)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const bands: Partial<Record<SleepComponent, ComponentBand>> = {}
  const components = {} as Record<SleepComponent, number | null>
  const triggered: SleepComponent[] = []
  let goodSignals = 0
  let baselineNights = 0

  for (const component of SLEEP_COMPONENTS) {
    const read = VALUE_OF[component]
    components[component] = read(target)

    const values: number[] = []
    for (const night of priorDesc) {
      const v = read(night)
      if (v === null || !Number.isFinite(v)) continue
      values.push(v)
      if (values.length === VERDICT_BASELINE_NIGHTS) break
    }
    const band = bandFor(values)
    if (!band) continue
    bands[component] = band
    baselineNights = Math.max(baselineNights, band.nights)

    const value = components[component]
    if (value === null || !Number.isFinite(value)) continue
    const below = value < band.low
    const above = value > band.high
    if (!below && !above) continue
    const poorSide = POOR_SIDE[component]
    if ((poorSide === 'low' && below) || (poorSide === 'high' && above)) triggered.push(component)
    else goodSignals++
  }

  if (Object.keys(bands).length === 0) return null

  // A poor signal outranks a good one. A long night that started two hours late is a night worth
  // flagging, and the owner can disagree in one tap — which is the data point this exists for.
  const verdict: SleepVerdict = triggered.length > 0 ? 'poor' : goodSignals > 0 ? 'good' : 'normal'

  return { verdict, triggered, components, bands, baselineNights, modelVersion: SLEEP_VERDICT_MODEL_VERSION }
}
