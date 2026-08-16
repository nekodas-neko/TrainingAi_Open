// "Move every hour" for the Activity score (W-B follow-up, 2026-07-23). Oura's own version buckets
// steps per hour, which this app doesn't store at hourly granularity — so this uses an honest proxy
// from the same intraday HR series already fetched for hrCurrent/hrMin/hrMax/hrAvg: an hour counts as
// "moved" when at least one reading that hour is above the SAME rest/active boundary Body Battery
// already uses (HR_REST_THRESHOLD, lib/health/hr-zones.ts) — not a second invented threshold.

import { hrReserve, HR_REST_THRESHOLD } from '@trainingai/shared/health/hr-zones'

export interface HourlyMovementInput {
  hrRows: { timestamp: Date; bpm: number }[]
  maxHr: number
  restingHr: number
  tz: string
  /** The day being scored, 'YYYY-MM-DD' in `tz` — only readings on this local day count. */
  dateIso: string
  /** Local-hour window considered "waking hours" for the goal denominator (inclusive start, exclusive end). */
  wakeHour?: number
  sleepHour?: number
}

const DEFAULT_WAKE_HOUR = 7
const DEFAULT_SLEEP_HOUR = 22 // 10pm — matches a typical waking day; the goal, not a hard cutoff on data

/**
 * Distinct **waking** local hours today with at least one HR reading above the rest threshold.
 * Returns 0 for an empty series — an honest zero, not a fabricated value.
 *
 * The waking-hour filter is what makes this comparable to its own goal (Q-188, 2026-08-11). This
 * function previously counted any hour in 0–23 while `moveHoursGoal()` divided by
 * `sleepHour − wakeHour`, so the ratio was structurally ≥ 1 and the contributor (weight 12) pinned
 * at 100 no matter what the goal was set to — it could never carry information. `wakeHour` and
 * `sleepHour` were already on `HourlyMovementInput`; they were simply never read here.
 *
 * The window is the same half-open `[wakeHour, sleepHour)` that `moveHoursGoal` measures, so
 * numerator and denominator agree by construction for any wake/sleep pair.
 */
export function computeMovedHours(input: HourlyMovementInput): number {
  const {
    hrRows, maxHr, restingHr, tz, dateIso,
    wakeHour = DEFAULT_WAKE_HOUR, sleepHour = DEFAULT_SLEEP_HOUR,
  } = input
  if (hrRows.length === 0) return 0

  const reserve = hrReserve(maxHr, restingHr)
  const movedHours = new Set<number>()

  for (const row of hrRows) {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
    }).formatToParts(row.timestamp)
    const day = `${local.find(p => p.type === 'year')!.value}-${local.find(p => p.type === 'month')!.value}-${local.find(p => p.type === 'day')!.value}`
    if (day !== dateIso) continue

    const hrr = (row.bpm - restingHr) / reserve
    if (hrr > HR_REST_THRESHOLD) {
      const hourStr = local.find(p => p.type === 'hour')!.value
      const hour = hourStr === '24' ? 0 : parseInt(hourStr, 10)
      if (hour < wakeHour || hour >= sleepHour) continue  // outside the goal's own window
      movedHours.add(hour)
    }
  }
  return movedHours.size
}

/** The goal denominator: how many waking hours today should have some movement. */
export function moveHoursGoal(wakeHour: number = DEFAULT_WAKE_HOUR, sleepHour: number = DEFAULT_SLEEP_HOUR): number {
  return Math.max(1, sleepHour - wakeHour)
}
