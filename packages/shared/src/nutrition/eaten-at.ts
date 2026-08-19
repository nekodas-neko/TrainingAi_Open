import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { DEFAULT_TZ } from '../date-utils'

/**
 * When the food was eaten, as distinct from when the row was created (Q-413).
 *
 * `food_logs.logged_at` defaulted to `now()`, so it meant "when you pressed the button". Log
 * yesterday's dinner over this morning's coffee and the row says 08:00 while its `date` says
 * yesterday — the two disagree and the timestamp is the wrong one. Back-filling a missed day is the
 * single most common way this log gets used after the fact, so that is not an edge case.
 *
 * The owner's rule, stated by them while reviewing Q-412: *"if its logged within the time bucket -
 * then record that as the time. If its added outside the window; then choose the midpoint of the
 * window."*
 *
 * **One formula, one place.** The web route, the offline `pushMutations` branch, the local write and
 * Q-412's reassign all call this. Four copies of a midpoint calculation is how the weekly-cadence
 * formula ended up with two different semantics.
 */

export interface MealWindow {
  /** Inclusive start hour, 0–23. */
  timeStartHour: number
  /** Exclusive end hour, 1–24. `24` is end-of-day and is NOT a wrap. */
  timeEndHour: number
}

export interface ResolveEatenAtInput {
  /** The log's own local date, `YYYY-MM-DD`. Anchoring to this — never to "today" — is the change. */
  date: string
  window: MealWindow
  /** The candidate instant: when the row was created, or what an offline replay carried. */
  at: Date
  /** The USER's timezone, from the session. Never the device's. */
  tz?: string
}

/** Length of a window in hours, treating `end <= start` as crossing midnight. */
function windowSpanHours({ timeStartHour: start, timeEndHour: end }: MealWindow): number {
  return end > start ? end - start : end + 24 - start
}

/**
 * Is `hour` inside the window?
 *
 * A wrapping window (22 → 02) is two arcs of the clock, so the test is a disjunction rather than a
 * range. `timeEndHour = 24` is the ordinary end-of-day case and stays a plain range: 21–24 admits
 * 21:00 through 23:59.
 */
export function hourInWindow(hour: number, { timeStartHour: start, timeEndHour: end }: MealWindow): boolean {
  return end > start ? hour >= start && hour < end : hour >= start || hour < end
}

/**
 * The window's midpoint, as an hour-of-day in 0–24.
 *
 * Lunch 12–15 → 13.5. Pre-workout 6–10 → 8. End-of-day 21–24 → 22.5.
 *
 * **A wrapping window's midpoint is projected back onto the same date**, which is the one place this
 * is a judgement rather than arithmetic. 22 → 02 has its true middle at midnight *between* D and
 * D+1; this returns 00:00 **on D**, because the log's `date` is D and a resolved timestamp that
 * lands on a different local day than the row it belongs to would reintroduce exactly the
 * disagreement this function exists to remove. (24 → 0 by the modulo, i.e. the start of D.)
 */
export function windowMidpointHour(window: MealWindow): number {
  return (window.timeStartHour + windowSpanHours(window) / 2) % 24
}

/**
 * Resolve the instant a food log should carry.
 *
 * - `at` falls on `date` **and** its local hour is inside the window → keep `at`. The user logged it
 *   as they ate it, and a real observation beats any derived one.
 * - otherwise → the window's midpoint on `date`, in the user's timezone.
 *
 * The midpoint is built with `fromZonedTime`, never `setHours` on a `Date`. `setHours` resolves in
 * the **device's** zone, so the same log would stamp a different instant on a phone set to another
 * country — this repo's most-repeated bug class, and `lib/meal-reminders.ts` still does it (that is
 * defensible there, because a reminder fires on the device; do not copy it here).
 */
export function resolveEatenAt({ date, window, at, tz = DEFAULT_TZ }: ResolveEatenAtInput): Date {
  const localDate = formatInTimeZone(at, tz, 'yyyy-MM-dd')
  if (localDate === date) {
    const hour = Number(formatInTimeZone(at, tz, 'H'))
    if (hourInWindow(hour, window)) return at
  }

  const mid = windowMidpointHour(window)
  const h = Math.floor(mid)
  const m = Math.round((mid - h) * 60)
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  return fromZonedTime(`${date}T${hh}:${mm}:00`, tz)
}
