// The closed part of an observed heart-rate window, kept for the user's local day (#3774).
//
// `getObservedHrProfile` merged about 90 days of heart rate on every call: 876 calls at 676 ms in
// production, more database time than everything else together. Only today's readings can change
// the answer within a day, so the window is split at the user's local midnight: the part before it
// is worked out once and kept here as a count per bpm, and each call reads only the rest.
//
// **Why the split is exact, not close.** The profile is a count, a sum, and two k-th order
// statistics over whole-number bpm values, all of which a count per bpm reproduces
// (`observedHrFromCounts`). What could break it is the merge: whether a row is read depends on its
// neighbours (an aggregator row yields to a device row within `AGGREGATOR_COVER_MS`; a ring row
// yields to a strap row in its 10-second bucket), and a neighbour can sit on the other side of
// midnight. So the kept part stops `MERGE_SEAM_MS` short of midnight. A row before that point can
// only be decided by rows before midnight, all of which are inside any window ending at or after
// it; every later row is decided by the live query, with the whole window's bounds, on each call.
//
// **One process.** This is a Map in the server's memory. The app runs as one long-lived process, so
// a write and the next read meet the same Map, and a restart costs one recompute per window. With
// two instances a write on one would leave the other's entry stale until `MAX_AGE_MS`; that would
// need the entries in a shared store, or the invalidation sent to every instance.
import { dateStrMidnightInTz, toAestDay } from '@trainingai/shared/date-utils'
import { AGGREGATOR_COVER_MS } from '@trainingai/shared/health/hr-window-merge'

/** bpm → how many merged readings had that value. Never mutated once stored. */
export type BpmCounts = ReadonlyMap<number, number>

/** The strap rule's bucket, as `preferStrapBuckets` and the SQL both spell it. */
const STRAP_BUCKET_MS = 10_000
/** The furthest a merge rule reaches from a row to the row that decides it. */
export const MERGE_SEAM_MS = Math.max(AGGREGATOR_COVER_MS, STRAP_BUCKET_MS)

/** A backstop for a write this file never hears about (a second instance, a script, a hand-run
 *  statement). Every writer in the app drops the entry itself; see `dropObservedHrDay`. */
export const MAX_AGE_MS = 6 * 60 * 60 * 1000
/** Three windows per user per day (the profile's 90 days and the cardio card's two 30s). */
export const MAX_ENTRIES = 300

interface Entry { userId: string; fromMs: number; midnightMs: number; filledAt: number; counts: Promise<BpmCounts> }
interface State { entries: Map<string, Entry>; enabled: boolean | null }

// On globalThis so every route bundle shares one Map (a module can be instantiated more than once).
const holder = globalThis as unknown as { __observedHrDayCache?: State }
const state: State = holder.__observedHrDayCache ??= { entries: new Map(), enabled: null }

/** Off under test unless a test turns it on, so suites sharing a user id never see each other's rows. */
export function observedHrDayCacheEnabled(): boolean {
  return state.enabled ?? (process.env.NODE_ENV !== 'test' && !process.env.VITEST)
}
/** `null` restores the default. Clears the entries either way. */
export function setObservedHrDayCacheEnabled(enabled: boolean | null): void {
  state.enabled = enabled
  state.entries.clear()
}
export function observedHrDayCacheSize(): number { return state.entries.size }

export interface ObservedHrSplit {
  /** The user's local date that `to` falls on. */
  localDate: string
  /** Rows before this instant are the kept part; rows from it on are read on every call. */
  closedEnd: Date
  /** That date's local midnight: no row before `closedEnd` is decided by a row at or after it. */
  midnight: Date
}

/**
 * Where a window splits, or null when it can't be split (it starts inside the seam, or the zone has
 * no midnight that day and the helper's answer lands after `to`): the caller then runs the direct
 * query. Midnight comes from the date string in the user's zone, never from subtracting days.
 */
export function splitObservedWindow(from: Date, to: Date, tz: string): ObservedHrSplit | null {
  const localDate = toAestDay(to, tz)
  const midnight = dateStrMidnightInTz(localDate, tz)
  if (!(midnight.getTime() <= to.getTime())) return null
  const closedEnd = new Date(midnight.getTime() - MERGE_SEAM_MS)
  if (!(from.getTime() < closedEnd.getTime())) return null
  return { localDate, closedEnd, midnight }
}

/** The kept counts for a window's closed part, filling them with `fill` when there is no live entry.
 *  Concurrent callers share one fill. A failed fill is not kept. */
export function closedObservedCounts(
  userId: string, from: Date, split: ObservedHrSplit, fill: () => Promise<BpmCounts>, now = Date.now(),
): Promise<BpmCounts> {
  const key = `${userId}|${from.getTime()}|${split.closedEnd.getTime()}|${split.localDate}`
  const hit = state.entries.get(key)
  if (hit && now - hit.filledAt <= MAX_AGE_MS) return hit.counts
  state.entries.delete(key)
  const counts = fill()
  const entry: Entry = { userId, fromMs: from.getTime(), midnightMs: split.midnight.getTime(), filledAt: now, counts }
  state.entries.set(key, entry)
  counts.catch(() => { if (state.entries.get(key) === entry) state.entries.delete(key) })
  for (const oldest of state.entries.keys()) {
    if (state.entries.size <= MAX_ENTRIES) break
    state.entries.delete(oldest)
  }
  return counts
}

/**
 * Drop a user's kept counts after heart-rate rows were written or deleted. With the earliest and
 * latest changed instants, only entries whose kept part those can touch go: a change before the
 * entry's midnight (a row in the last `MERGE_SEAM_MS` of the day still decides kept rows) and not
 * wholly before its window. Today's readings touch none, so an ordinary sync leaves the day's entry
 * alone. Without the instants, every entry of the user's goes.
 *
 * An entry still being filled is dropped too: its fill may have read the table before the write.
 * Call it after the write is committed, never inside its transaction.
 */
export function dropObservedHrDay(userId: string, changed?: { earliestMs: number; latestMs: number }): void {
  for (const [key, e] of state.entries) {
    if (e.userId !== userId) continue
    if (changed && !(changed.earliestMs < e.midnightMs && changed.latestMs >= e.fromMs)) continue
    state.entries.delete(key)
  }
}

/** How many of each query ran, for tests and for measuring a route. */
export const observedHrQueryCounts = { direct: 0, closedFill: 0, todayOnly: 0 }
