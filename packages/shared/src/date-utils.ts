import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'

export const DEFAULT_TZ = 'Australia/Brisbane'

// Returns the UTC Date representing midnight in `tz` for a given calendar date.
// Normalizes day/month overflow first (e.g. callers passing `d + 1` on the last
// day of a month would otherwise build an invalid string like "2026-06-31",
// which throws "Invalid time value" when serialized). Date.UTC rolls Jun 31 → Jul 1.
export function aestMidnight(y: number, m: number, d: number, tz = DEFAULT_TZ): Date {
  const norm = new Date(Date.UTC(y, m - 1, d))
  return fromZonedTime(
    `${norm.getUTCFullYear()}-${String(norm.getUTCMonth() + 1).padStart(2, '0')}-${String(norm.getUTCDate()).padStart(2, '0')}T00:00:00`,
    tz,
  )
}

// Converts a UTC Date to "YYYY/MM/DD" in `tz`.
export function toAestDateStr(d: Date, tz = DEFAULT_TZ): string {
  return formatInTimeZone(d, tz, 'yyyy/MM/dd')
}

// Converts a UTC Date to "YYYY-MM-DD" in `tz`.
export function toAestDay(d: Date, tz = DEFAULT_TZ): string {
  return formatInTimeZone(d, tz, 'yyyy-MM-dd')
}

// Returns today's date as "YYYY-MM-DD" in `tz`.
export function todayInTz(tz = DEFAULT_TZ): string {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
}

// Returns the current moment as "YYYY/MM/DD HH:MM" in `tz` — the user-timezone
// analogue of the device-local localDatetimeString() in lib/utils. Use for any
// date/datetime a workout write stamps so a log made near midnight on a device set
// to a different tz lands on the user's calendar day, not the device's (WK-16).
export function nowDatetimeInTz(tz = DEFAULT_TZ): string {
  return formatInTimeZone(new Date(), tz, 'yyyy/MM/dd HH:mm')
}

// Returns 0=Mon … 6=Sun for the current moment in `tz`.
export function todayDayOfWeek(tz = DEFAULT_TZ): number {
  return (toZonedTime(new Date(), tz).getDay() + 6) % 7
}

// Returns the Monday of the current week as "YYYY-MM-DD" in `tz`.
export function startOfWeekInTz(tz = DEFAULT_TZ): string {
  const today = todayInTz(tz)
  const dow = todayDayOfWeek(tz) // 0=Mon … 6=Sun
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dow)
  return formatInTimeZone(d, 'UTC', 'yyyy-MM-dd')
}

// Returns the Monday on/before an arbitrary "YYYY-MM-DD" day string — the same Mon-Sun week
// convention as startOfWeekInTz, but for a historical date rather than "now". Used to bucket a
// day-by-day range into weekly totals (cardio trends).
export function weekStartForDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // 0=Mon … 6=Sun
  d.setUTCDate(d.getUTCDate() - dow)
  return formatInTimeZone(d, 'UTC', 'yyyy-MM-dd')
}

// Formats a UTC millisecond timestamp as "8:30am" in `tz`.
export function fmtAest(ms: number, tz = DEFAULT_TZ): string {
  return formatInTimeZone(new Date(ms), tz, 'h:mmaaa')
}

/**
 * Formats an instant as a time of day — "7:05 am" — in `tz`, NOT the device's timezone.
 *
 * `toLocaleTimeString` without an explicit `timeZone` renders in whatever zone the *device* is set
 * to, which silently disagrees with every stored value the moment the two differ — the same class of
 * bug as `new Date().toISOString().slice(0,10)`, and just as invisible while you are sitting in the
 * zone the data was recorded in. Six user-facing screens formatted times that way; this is the one
 * place that decides how a clock time is rendered.
 *
 * `h:mm aaa` is byte-identical to the `en-AU` output it replaced, so adopting it changes the zone
 * without changing the look.
 *
 * Accepts an ISO string or epoch millis. Returns '' for an unparseable input rather than
 * "Invalid Date" — a broken timestamp should render as absent, not as a word.
 */
export function formatTimeOfDay(at: string | number | Date, tz = DEFAULT_TZ): string {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return formatInTimeZone(d, tz, 'h:mm aaa')
}

// Formats an instant as "HH:MM" (24-hour) in `tz` — for a clock time that gets PERSISTED
// (activity_logs.start_time/end_time). Four sites built this from the device's own getHours(),
// which stores whatever the phone's clock said rather than the user's wall time; unlike a
// rendering bug, that value is wrong in the database forever.
export function msToHHMMInTz(at: string | number | Date, tz = DEFAULT_TZ): string {
  const d = at instanceof Date ? at : new Date(at)
  return formatInTimeZone(d, tz, 'HH:mm')
}

// Formats a "HH:MM" 24-hour time string as "8:30am" (12-hour, no leading zero).
export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')}${period}`
}

// Returns the UTC Date for midnight-in-tz today (used for accurate i-days-ago arithmetic).
// e.g. at 9 AM AEST, Date.now() - 86400000 is NOT "yesterday AEST midnight" — this is.
export function todayMidnightUtc(tz = DEFAULT_TZ): Date {
  return fromZonedTime(formatInTimeZone(new Date(), tz, 'yyyy-MM-dd') + 'T00:00:00', tz)
}

// Converts a "YYYY-MM-DD" date string into the UTC Date for midnight-in-tz on that day.
export function dateStrMidnightInTz(dateStr: string, tz = DEFAULT_TZ): Date {
  return fromZonedTime(`${dateStr}T00:00:00`, tz)
}

// Seconds elapsed since local-midnight-today in `tz`, clamped to [0, 86400].
// Used to treat "today" as a partial day for cumulative per-day metrics
// (e.g. Oura non-wear time) instead of assuming a full 86,400 s.
export function secondsSinceLocalMidnight(tz = DEFAULT_TZ): number {
  return Math.min(86400, Math.max(0, (Date.now() - todayMidnightUtc(tz).getTime()) / 1000))
}

// Parses a "YYYY-MM-DD" or "YYYY/MM/DD" date string, validates it is a real
// calendar date, and returns it normalized to "YYYY/MM/DD" (or null if invalid).
// Guards route params against malformed input (wrong separator, "2026-06-31",
// month 00/13) that would otherwise build an invalid Date and throw
// "Invalid time value" deep in downstream date arithmetic.
export function normalizeDateParam(input: string): string | null {
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(input)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) return null
  return `${m[1]}/${m[2]}/${m[3]}`
}

// Same validation as normalizeDateParam but returns the DASH form ('YYYY-MM-DD').
// Use for consumers that do dash-based arithmetic (string.split('-'), dash-keyed DB
// rows) — feeding them normalizeDateParam's slash output is how zone-minutes and
// training-stress went feature-dead (J-8/J-9). Kept separate from normalizeDateParam
// so its 10 existing importers keep the slash form they expect.
export function normalizeDateParamIso(input: string): string | null {
  const slash = normalizeDateParam(input)
  return slash === null ? null : slash.replace(/\//g, '-')
}

/**
 * Is this a real calendar day, not merely a date-SHAPED string?
 *
 * The `^\d{4}[-/]\d{2}[-/]\d{2}$` regexes scattered through the route schemas bound the shape and
 * nothing else, so `2026-13-45`, `2026-02-31` and `0000-00-00` all pass and then fail at the
 * Postgres driver as `[pg 22008]` — a client input error recorded as a server fault (Q-496).
 * Measured: `POST /api/day-checkin {"date":"2026-13-45"}` answered **500** and wrote an
 * `error_events` row; the same value through `/api/sync/push` echoed the whole INSERT statement back
 * to the caller.
 *
 * `Date` will not refuse those — it normalises Feb 31 to March 3 — so the test is a round trip:
 * a value that is not its own zero-day shift was never that day.
 */
export function isCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(dateStr)) return false
  const iso = dateStr.replace(/\//g, '-')
  return shiftDateStr(iso, 0) === iso
}

// Shifts a YYYY-MM-DD string by N calendar days without touching toISOString().
//
// The year is padded to four digits (Q-497). Month and day always were; the year was the one field
// without it, so a year under 1000 emitted `999-01-01` — three digits, which sorts BEFORE
// `1000-01-01` in any string comparison and silently reorders a range.
//
// **This does NOT make the output safe to compare as a string in a loop bound**, and it is worth
// being exact about why, because the obvious reading is that it does. `padStart` cannot help at the
// TOP of the range: one day after `9999-12-31` is `10000-01-01`, five digits, and
// `'10000-01-01' <= '9999-12-31'` is `true` because `'1' < '9'`. Two admin routes looped ~29M times
// on exactly that. A `YYYY-MM-DD` contract cannot express a five-digit year, so the fix belongs at
// the call site: iterate a validated day COUNT, never `for (d = start; d <= end; …)`.
//
// The 0–99 year range is corrected inside the function (Q-329) — `Date.UTC` would otherwise read it
// as 1900+y and move a first-century date by ~1,900 years.
export function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  // `Date.UTC` applies the legacy two-digit-year mapping: a year of 0–99 is read as 1900+y, so
  // `shiftDateStr('0001-01-01', -1)` returned **1900-12-31** instead of 0000-12-31 — off by ~1,900
  // years, silently (Q-329). Undo it for exactly that range and leave every ordinary year on the
  // path all the existing tests cover.
  //
  // Deliberately a correction rather than a rebuild: constructing in a safe year and re-stamping
  // was tried first and is WRONG — anchoring on 2000 (a leap year) makes `2026-03-01` minus a day
  // return March 1 again, because the intermediate lands on Feb 29 and re-stamping a non-leap year
  // rolls it forward. The conditional keeps that whole class out of the common path.
  if (y >= 0 && y < 100) shifted.setUTCFullYear(shifted.getUTCFullYear() - 1900)
  return [
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * A slash-separated calendar-day key (`YYYY/MM/DD`) in the given timezone, optionally N days back.
 *
 * This is the key the calendar/week-strip surfaces bucket by, and it must match how the server
 * buckets day summaries — which since Q-144 is the **user's** zone, not `DEFAULT_TZ`. It existed as
 * two identical copies hardcoded to `DEFAULT_TZ` (`session-select-content.tsx`,
 * `workout-select-content.tsx`), which is how Q-163's four listed sites turned out to be six. One
 * copy, taking the zone explicitly, so a caller cannot silently get Brisbane's day.
 *
 * `at` is injectable so a test can pin BOTH sides of the comparison — a zone-straddling
 * assertion against the real clock only fails during the hours it straddles.
 */
export function dayKeyInTz(tz: string, daysAgo = 0, at: Date = new Date()): string {
  return shiftDateStr(formatInTimeZone(at, tz, 'yyyy-MM-dd'), -daysAgo).replace(/-/g, '/')
}

// Whole calendar days between two date strings ('YYYY-MM-DD' or 'YYYY/MM/DD', either
// separator). UTC-day arithmetic on pure date keys — matches shiftDateStr's semantics.
// Positive when `toStr` is after `fromStr`.
export function daysBetweenDateStrs(fromStr: string, toStr: string): number {
  const norm = (s: string) => s.replace(/\//g, '-') + 'T00:00:00Z'
  const from = new Date(norm(fromStr)).getTime()
  const to = new Date(norm(toStr)).getTime()
  return Math.round((to - from) / 86_400_000)
}

// Display formatter for a raw 'YYYY-MM-DD' or 'YYYY/MM/DD' date string — 'short' gives
// "Jan 5" (sheet/card labels), 'long' gives "Monday, 5 January" (detail headers). Returns
// the raw input unchanged if it doesn't parse as a date.
export function formatDateDisplay(raw: string, style: 'short' | 'long' = 'short'): string {
  // Component-wise, for the reason formatDayShort below states and this function used to ignore:
  // `new Date('2026-07-06')` parses as UTC midnight, so west of UTC it renders the previous day
  // (Q-130). Correct on the owner's Brisbane device, off by one everywhere behind UTC.
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(raw)
  if (!m) return raw
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (isNaN(d.getTime())) return raw
  return style === 'long'
    ? d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    : d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })
}

/** 'YYYY-MM-DD' → 'Jul 6'. Component-wise construction — never `new Date(isoDay)`,
 *  which parses as UTC midnight and shifts the day in AEST. */
export function formatDayShort(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })
}

/** Whole years from a 'YYYY-MM-DD' date of birth to `now`. null when unknown or
 *  out of a sane human range. Used for age-predicted HRmax. */
export function ageFromDob(dob: string | undefined | null, now: Date): number | null {
  if (!dob) return null
  const birth = new Date(dob)
  if (isNaN(birth.getTime())) return null
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  return age > 0 && age < 120 ? age : null
}
