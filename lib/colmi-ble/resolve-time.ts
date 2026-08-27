// Turning the ring's relative time into instants — the one place that decision is made.
//
// `decode.ts` deliberately returns time the way the ring expresses it (`daysAgo`, `minuteOfDay`,
// BCD parts) and never builds a Date, because the reference client resolves these against the
// DEVICE's timezone and this app must resolve them against the USER's. This module is that
// resolution, kept pure and separate so it can be tested at the boundaries where it breaks.
//
// Why not `midnight + minutes * 60_000`: that is wrong across a DST transition, where a local day
// is 23 or 25 hours long. The owner's zone (Australia/Brisbane) has no DST and would never show it,
// which is exactly why it would ship. Building the local wall-clock string and converting once is
// correct in every zone.
import { fromZonedTime } from 'date-fns-tz'
import { shiftDateStr, DEFAULT_TZ } from '@trainingai/shared/date-utils'

const MINUTES_PER_DAY = 1440

/**
 * Resolve a `(daysAgo, minuteOfDay)` pair against `todayStr` (a 'YYYY-MM-DD' day already resolved
 * in `tz`) to a UTC instant.
 *
 * `minuteOfDay` may fall outside a single day and is normalised rather than clamped: the ring
 * reports a sleep session that began before midnight as a minute count past 1440 relative to the
 * *following* day, and HRV/stress packet offsets can run past the end of a day when a series spans
 * one. Clamping either would silently stack samples on a boundary.
 */
export function resolveRelative(
  todayStr: string,
  daysAgo: number,
  minuteOfDay: number,
  tz: string = DEFAULT_TZ,
): Date {
  const totalMinutes = Math.trunc(minuteOfDay)
  // Floor division so a negative minute (a session that started before the day) rolls back a day
  // rather than toward zero, which `Math.trunc` would do and which would be off by a whole day.
  const dayShift = Math.floor(totalMinutes / MINUTES_PER_DAY)
  const within = totalMinutes - dayShift * MINUTES_PER_DAY
  const dayStr = shiftDateStr(todayStr, -Math.trunc(daysAgo) + dayShift)
  const hh = String(Math.floor(within / 60)).padStart(2, '0')
  const mm = String(within % 60).padStart(2, '0')
  return fromZonedTime(`${dayStr}T${hh}:${mm}:00`, tz)
}

/**
 * A sleep session's start and end, resolved. The ring gives both as minutes after the midnight of
 * `daysAgo`; when `startMinute > endMinute` the session began BEFORE that midnight, so the start
 * belongs to the previous day.
 */
export function resolveSleepWindow(
  todayStr: string,
  daysAgo: number,
  startMinute: number,
  endMinute: number,
  tz: string = DEFAULT_TZ,
): { startedAt: Date; endedAt: Date } {
  const startsPreviousDay = startMinute > endMinute
  return {
    startedAt: resolveRelative(todayStr, daysAgo, startsPreviousDay ? startMinute - MINUTES_PER_DAY : startMinute, tz),
    endedAt: resolveRelative(todayStr, daysAgo, endMinute, tz),
  }
}

/**
 * An activity bucket's instant, from the BCD date parts and the ring's quarter-of-day index.
 * The ring's own calendar is used here rather than `daysAgo`, so this needs no reference day —
 * but it still needs `tz`, because those parts are wall-clock, not UTC.
 */
export function resolveActivityBucket(
  year: number, month: number, day: number, quarterHour: number, tz: string = DEFAULT_TZ,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (quarterHour < 0 || quarterHour > 95) return null
  const dayStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const hh = String(Math.floor(quarterHour / 4)).padStart(2, '0')
  const mm = String((quarterHour % 4) * 15).padStart(2, '0')
  const at = fromZonedTime(`${dayStr}T${hh}:${mm}:00`, tz)
  return Number.isNaN(at.getTime()) ? null : at
}

/**
 * A day's local midnight expressed as seconds, as though that wall-clock were UTC.
 *
 * This is what the ring's heart-rate log request wants — not a real epoch. Gadgetbridge builds the
 * same number as `millis + ZONE_OFFSET + DST_OFFSET`; `Date.UTC` on the date parts gets there
 * directly and without reading a clock or a zone, because the value is deliberately zone-free.
 */
export function localDayStartSeconds(dayStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayStr)
  if (!m) return 0
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000)
}

/**
 * Turn the ring's echoed heart-rate anchor into a real instant.
 *
 * `cmdSyncHeartRate` sends the day's local midnight expressed as though it were UTC, because that
 * is what the ring wants (see its comment). The ring echoes that same number back in packet 1, and
 * reading it as a genuine epoch puts every sample **the size of the timezone offset late** — ten
 * hours in Brisbane. Measured 2026-08-27: the ring's own log ran 06:50–20:50 and was stored as
 * 16:50–06:50 the next day, so 119 of 157 samples landed in the future and were rejected by the
 * ingest's 60-second future tolerance. The 38 that survived were morning readings wearing evening
 * timestamps, which is what made the ring look 15 bpm high against the Oura.
 *
 * So: read the number as the wall clock it actually is, then place that wall clock in the user's
 * zone.
 */
export function wallClockSecondsToEpochMs(wallSeconds: number, tz: string = DEFAULT_TZ): number {
  const asIfUtc = new Date(Math.trunc(wallSeconds) * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const wall = `${asIfUtc.getUTCFullYear()}-${p(asIfUtc.getUTCMonth() + 1)}-${p(asIfUtc.getUTCDate())}`
    + `T${p(asIfUtc.getUTCHours())}:${p(asIfUtc.getUTCMinutes())}:${p(asIfUtc.getUTCSeconds())}`
  return fromZonedTime(wall, tz).getTime()
}
