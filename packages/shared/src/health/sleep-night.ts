// Which sleep sessions make up "the night" — One Formula, One Place.
//
// The ring emits one session per uninterrupted sleep window, so a single night can arrive as two or
// more rows, and a daytime nap is indistinguishable from a night fragment by shape alone. Every
// consumer previously answered "which row is the night?" for itself, and all of them answered it the
// same wrong way: sort by `sleepEnd` descending and take the first. On any day with a nap after
// waking, the nap won (audit findings F-1 and Q-1). It produced a Sleep Score of 5 on a 7.86 h night,
// and — because the rollup folds its pick into the checkpointed EMA baselines — it poisoned every
// later z-score too.
//
// ## Why gap-merging alone does not work
//
// The obvious fix, "merge windows closer together than N minutes", fails on this history. Measured
// across every session pair in production:
//
//   05-29 00:38 → 02:23   105 min   a GENUINE fragmented night (2.53 h + 4.02 h, one sleep)
//   06-29 21:14 → 22:21    67 min   an evening NAP followed by the night
//   07-01 20:19 → 21:40    81 min   ditto
//   06-27 20:53 → 22:26    94 min   ditto
//
// The real fragmented night has a *larger* gap than three nap→night transitions, so no threshold
// separates them. What does separate them cleanly is *when* the sleep sat: every real night in the
// history has a midpoint between 01:00 and 04:30, while every nap's midpoint falls outside
// 21:00–10:00 (the closest are an evening nap at 20:53 and a late-morning one at 10:14).
//
// So: classify by circadian position FIRST, then merge fragments within the night band. A nap can
// never be merged into a night because it never enters the band, and a fragmented night reassembles
// however long its wake-up gap was.

import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

/** Local hour (inclusive) at which the night band opens. A sleep whose MIDPOINT falls at or after
 *  this hour, or before {@link NIGHT_BAND_END_HOUR}, is night sleep rather than a nap. */
export const NIGHT_BAND_START_HOUR = 21
/** Local hour (exclusive) at which the night band closes. */
export const NIGHT_BAND_END_HOUR = 10
/**
 * Longest wake-up gap that still counts as the same night. Generous on purpose: it only ever applies
 * between two windows that are BOTH already inside the night band, so a nap cannot slip through it.
 * The one genuine fragmented night in the history has a 105-minute gap.
 */
export const MAX_INTRA_NIGHT_GAP_HOURS = 3
/**
 * A sleep this long is night sleep wherever it sat on the clock. Naps are short by definition — the
 * longest in the whole history is 1.42 h, while the shortest real night is 5.33 h — so this costs
 * nothing in normal use, and it stops the circadian rule failing catastrophically for anyone whose
 * sleep isn't nocturnal (shift work, jet lag, a daytime recovery sleep). Without it such a sleeper
 * would have every sleep classified as a nap and score nothing at all.
 */
export const ALWAYS_NIGHT_MIN_HOURS = 4

/** The minimum shape this module needs. `SleepSession` satisfies it. */
export interface SleepWindow {
  sleepStart: Date
  sleepEnd: Date
  durationHours?: number | null
}

/**
 * True when a row records any sleep at all. Exported because the sleep list's own merge
 * (`lib/sleep/merge-sessions.ts`) needs the same answer, and a second copy there is how the two
 * drift — this module is where "does this row record sleep" is decided.
 *
 * Production carries rows with `duration_hours = 0.00` — a bed period the recorder never resolved
 * into sleep. They are not short nights; they are non-nights, and `computeSleepScore` returns null
 * for exactly this case (`duration == null || duration <= 0`). Left in, such a row can become the
 * most recent "night", which nulls the readiness composite's `previousNight` contributor and
 * renormalises a real night's sleep out of the score entirely (Q-10).
 *
 * The bar is deliberately zero, not twenty minutes. Q-10's entry suggested skipping sub-20-minute
 * sessions, but a short window is legitimate — `groupSleepPeriods` merges them into fragmented
 * nights on purpose, and `computeSleepScore` scores a 15-minute session perfectly happily (badly,
 * which is correct). Only a window with NO duration is meaningless, and it is the only one that can
 * produce the null this fixes.
 */
export function recordsSleep(durationHours: number | null | undefined): boolean {
  return durationHours != null && durationHours > 0
}

/** {@link recordsSleep} for a whole window. */
function hasSleep(w: SleepWindow): boolean {
  return recordsSleep(w.durationHours)
}

/** Local hour-of-day (0–24, fractional) of an instant. */
function localHour(at: Date, tz: string): number {
  const [h, m] = formatInTimeZone(at, tz, 'HH:mm').split(':').map(Number)
  return h + m / 60
}

/** True when this window is night sleep rather than a nap: its midpoint sits inside the night band,
 *  OR it is simply long enough that it cannot be a nap wherever it sat (see ALWAYS_NIGHT_MIN_HOURS). */
export function isNightWindow(w: SleepWindow, tz: string = DEFAULT_TZ): boolean {
  if ((w.durationHours ?? 0) >= ALWAYS_NIGHT_MIN_HOURS) return true
  const mid = localHour(new Date((w.sleepStart.getTime() + w.sleepEnd.getTime()) / 2), tz)
  // The band wraps midnight, so "inside" means at/after the start OR before the end.
  return mid >= NIGHT_BAND_START_HOUR || mid < NIGHT_BAND_END_HOUR
}

/** One night's worth of sleep: the windows that compose it, in chronological order. */
export interface SleepPeriod<T extends SleepWindow> {
  /** Wake day (YYYY-MM-DD, local) — the local date the LAST window ended on. */
  date: string
  windows: T[]
  /** Wall-clock gaps between consecutive windows, in hours. Empty for an unfragmented night. */
  gapHours: number[]
}

/**
 * Group a set of sleep windows into nights. Naps (anything whose midpoint falls outside the night
 * band) are returned separately and never join a night.
 *
 * Night windows are merged when the gap between them is at most {@link MAX_INTRA_NIGHT_GAP_HOURS};
 * a longer gap starts a new night. Periods are returned oldest-first.
 */
export function groupSleepPeriods<T extends SleepWindow>(
  sessions: T[],
  tz: string = DEFAULT_TZ,
): { nights: SleepPeriod<T>[]; naps: T[] } {
  const naps: T[] = []
  const nightWindows: T[] = []
  for (const s of sessions) {
    if (!hasSleep(s)) continue
    ;(isNightWindow(s, tz) ? nightWindows : naps).push(s)
  }
  nightWindows.sort((a, b) => a.sleepStart.getTime() - b.sleepStart.getTime())

  const nights: SleepPeriod<T>[] = []
  for (const w of nightWindows) {
    const open = nights[nights.length - 1]
    const prev = open?.windows[open.windows.length - 1]
    const gapH = prev ? (w.sleepStart.getTime() - prev.sleepEnd.getTime()) / 3_600_000 : Infinity
    if (open && gapH <= MAX_INTRA_NIGHT_GAP_HOURS) {
      open.windows.push(w)
      open.gapHours.push(Math.max(0, gapH))
      open.date = formatInTimeZone(w.sleepEnd, tz, 'yyyy-MM-dd')
    } else {
      nights.push({ date: formatInTimeZone(w.sleepEnd, tz, 'yyyy-MM-dd'), windows: [w], gapHours: [] })
    }
  }
  return { nights, naps }
}

/** Total sleep across a period's windows. */
export function totalSleepHours<T extends SleepWindow>(period: SleepPeriod<T>): number {
  return period.windows.reduce((s, w) => s + (w.durationHours ?? 0), 0)
}

/**
 * One period per wake date — **the longer wins, total sleep rather than recency.**
 *
 * A wake-day can carry two night periods: a night that ended in the morning, and a later window the
 * classifier also called night (`ALWAYS_NIGHT_MIN_HOURS` promotes anything over four hours wherever
 * it sat on the clock). Which of the two is "that day's night" is one decision, and this is where it
 * is made.
 *
 * **It is a function because it was a duplicated rule, and the copy was wrong (PS-17).** The BLE
 * rollup resolved its own per-date map with a bare `.set()` in a loop, which is last-wins — so on
 * 2026-08-27 a 4.75 h daytime window (HRV 26.5 and RHR 74, i.e. awake values) replaced the real
 * 7.42 h night in `oura_daily_summary`, and readiness for that day scored on a nap that did not
 * happen. `nightForDate` below had the correct rule the whole time. Both now call this.
 */
export function nightPeriodsByDate<T extends SleepWindow>(
  periods: SleepPeriod<T>[],
): Map<string, SleepPeriod<T>> {
  const byDate = new Map<string, SleepPeriod<T>>()
  for (const period of periods) {
    const incumbent = byDate.get(period.date)
    if (incumbent && totalSleepHours(incumbent) >= totalSleepHours(period)) continue
    byDate.set(period.date, period)
  }
  return byDate
}

/**
 * The night belonging to a given wake day, or null. When a day somehow carries more than one night
 * period (a very early night plus a very late one), the longer wins — total sleep, not recency.
 */
export function nightForDate<T extends SleepWindow>(
  sessions: T[],
  date: string,
  tz: string = DEFAULT_TZ,
): SleepPeriod<T> | null {
  const { nights } = groupSleepPeriods(sessions, tz)
  return nightPeriodsByDate(nights).get(date) ?? null
}

/** The most recent night at or before `date`, or null. Used where a caller wants "last night". */
export function latestNight<T extends SleepWindow>(
  sessions: T[],
  tz: string = DEFAULT_TZ,
): SleepPeriod<T> | null {
  const { nights } = groupSleepPeriods(sessions, tz)
  return nights.length ? nights[nights.length - 1] : null
}

// ── Aggregating a fragmented night into one scoreable session ────────────────

/** The subset of `SleepSession` fields aggregation reads and writes. */
export interface AggregatableSleep extends SleepWindow {
  date: string
  deepSleepHours?: number | null
  remSleepHours?: number | null
  lightSleepHours?: number | null
  awakHours?: number | null
  efficiency?: number | null
  onsetLatencySec?: number | null
  averageHrvMs?: number | null
  avgHeartRate?: number | null
  lowestHeartRate?: number | null
  restlessPeriods?: number | null
  respiratoryRate?: number | null
  timeInBedHours?: number | null
}

const sum = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) : null
}
/** Duration-weighted mean — a 6 h segment should count for more than a 1 h one. */
const weightedMean = (
  parts: { value: number | null | undefined; weight: number }[],
): number | null => {
  const v = parts.filter(p => p.value != null && p.weight > 0)
  if (!v.length) return null
  const wsum = v.reduce((s, p) => s + p.weight, 0)
  return wsum > 0 ? v.reduce((s, p) => s + p.value! * p.weight, 0) / wsum : null
}

/**
 * Collapse a night's windows into a single session. A one-window night is returned **unchanged** —
 * this deliberately does not recompute anything for the overwhelmingly common case, so the change
 * is confined to genuinely fragmented nights and to which row gets picked at all.
 *
 * For a fragmented night: sleep hours and stages sum, time-in-bed spans the whole period *including*
 * the wake-up gap, efficiency is recomputed from those two (so a fragmented night scores lower than
 * an unbroken one of the same total sleep — which is the point), each gap counts as an awakening, and
 * the autonomic readings are duration-weighted.
 */
export function aggregateNight<T extends AggregatableSleep>(period: SleepPeriod<T>): T {
  const w = period.windows
  // Single-window fast path: nothing is recomputed, but the wake day is always restamped from the
  // window's own end time. Production carries rows whose stored `date` disagrees with their Brisbane
  // wake day, and a consumer looking a night up by date must not miss it because of that.
  if (w.length === 1) return { ...w[0], date: period.date }

  const first = w[0]
  const last = w[w.length - 1]
  const durations = w.map(x => x.durationHours ?? 0)
  const totalSleep = durations.reduce((a, b) => a + b, 0)
  const gapTotal = period.gapHours.reduce((a, b) => a + b, 0)
  const timeInBed = (last.sleepEnd.getTime() - first.sleepStart.getTime()) / 3_600_000
  const weighted = (pick: (x: T) => number | null | undefined) =>
    weightedMean(w.map((x, i) => ({ value: pick(x), weight: durations[i] })))

  return {
    ...first,
    date: period.date,
    sleepStart: first.sleepStart,
    sleepEnd: last.sleepEnd,
    durationHours: totalSleep,
    timeInBedHours: timeInBed,
    efficiency: timeInBed > 0 ? Math.min(100, Math.round((totalSleep / timeInBed) * 100)) : null,
    deepSleepHours: sum(w.map(x => x.deepSleepHours)),
    remSleepHours: sum(w.map(x => x.remSleepHours)),
    lightSleepHours: sum(w.map(x => x.lightSleepHours)),
    // Time awake inside the period = each window's own awake time plus every wake-up gap.
    awakHours: (sum(w.map(x => x.awakHours)) ?? 0) + gapTotal,
    // Falling asleep is something you do once, at the start of the night.
    onsetLatencySec: first.onsetLatencySec ?? null,
    averageHrvMs: weighted(x => x.averageHrvMs),
    avgHeartRate: weighted(x => x.avgHeartRate),
    respiratoryRate: weighted(x => x.respiratoryRate),
    lowestHeartRate: (() => {
      const v = w.map(x => x.lowestHeartRate).filter((x): x is number => x != null)
      return v.length ? Math.min(...v) : null
    })(),
    // Every gap is by definition a wake-up, on top of whatever each window already counted.
    restlessPeriods: (sum(w.map(x => x.restlessPeriods)) ?? 0) + period.gapHours.length,
  }
}

/**
 * Every night in `sessions`, aggregated into one session each, oldest first. Naps are dropped.
 * This is what score consumers want: a clean nightly series with fragmented nights reassembled and
 * daytime sleep excluded, so `.at(-1)` is last night and `.slice(0, -1)` is its baseline history.
 */
export function nightSessions<T extends AggregatableSleep>(sessions: T[], tz: string = DEFAULT_TZ): T[] {
  return groupSleepPeriods(sessions, tz).nights.map(aggregateNight)
}
