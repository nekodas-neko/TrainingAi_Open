import { formatDayShort, shiftDateStr } from '../date-utils'
import { canonicalLatestNight, isNightWindow } from './sleep-night'

// Which night the Body tab's Sleep card shows, and the date label printed on it. Both apps call this
// (issue 2906): the current app showed the newest night dated today OR yesterday with no date on the
// card, Preview showed only a night dated today, so on a morning the ring had not yet delivered the
// night the two cards disagreed and neither said which night it was. The rule lives here once.
//
// `sleep_sessions.date` is the wake-up day, so "today" is the night that ended this morning. What
// counts as a night is NOT decided here: it is `isNightWindow` + `canonicalLatestNight` from
// `sleep-night.ts`, the rule behind the readiness payload and the sleep score badge, so a nap or a
// short evening bout is never captioned "Night ending …" when a real night exists for yesterday.

/** `2026-10-18` -> `18 Oct`. Calendar arithmetic on the string; no timezone is involved. */
export const sleepNightDateLabel = formatDayShort

export interface SleepCardNight<T extends { date: string }> {
  /** The night the card shows, or null when nothing recent enough exists. */
  night: T | null
  /** The caption for the card: names the night's date, or says which older night exists. */
  label: string
}

/** The row fields the canonical night rule reads. A row with no times cannot be classified. */
interface SleepCardRow {
  date: string
  sleepStart?: string | Date | null
  sleepEnd?: string | Date | null
  durationHours?: number | null
}

const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v))

/**
 * Pick the card's night from `rows` (any order): the canonical latest night, shown only when it is
 * dated `today` or the day before. Anything older is stale and is not shown as if current; the label
 * then says when the newest recorded night was. Rows dated after `today` are ignored (a clock-skewed
 * or mis-dated row). A row without start and end times cannot be told from a nap, so it is taken as
 * a night, as the sleep list's own merge does.
 */
export function pickSleepCardNight<T extends SleepCardRow>(
  rows: readonly T[],
  today: string,
  tz: string,
): SleepCardNight<T> {
  const yesterday = shiftDateStr(today, -1)
  const timed = new Map<T, T & { sleepStart: Date; sleepEnd: Date }>()
  const untimed: T[] = []
  for (const row of rows) {
    if (row.date > today) continue
    if (row.sleepStart && row.sleepEnd) {
      const w = { ...row, sleepStart: toDate(row.sleepStart), sleepEnd: toDate(row.sleepEnd) }
      if (isNightWindow(w, tz)) timed.set(row, w)
    } else {
      untimed.push(row)
    }
  }
  const canonical = canonicalLatestNight([...timed.values()], tz)
  const timedNight = canonical ? ([...timed].find(([, w]) => w === canonical)?.[0] ?? null) : null
  let newest = timedNight
  for (const row of untimed) if (!newest || row.date > newest.date) newest = row
  if (newest && newest.date >= yesterday) {
    return { night: newest, label: `Night ending ${sleepNightDateLabel(newest.date)}` }
  }
  return {
    night: null,
    label: newest ? `Last recorded ${sleepNightDateLabel(newest.date)}` : 'No night recorded',
  }
}
