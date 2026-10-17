import { shiftDateStr } from '../date-utils'

// Which night the Body tab's Sleep card shows, and the date label printed on it. Both apps call this
// (issue 2906): the current app showed the newest night dated today OR yesterday with no date on the
// card, Preview showed only a night dated today, so on a morning the ring had not yet delivered the
// night the two cards disagreed and neither said which night it was. The rule lives here once.
//
// `sleep_sessions.date` is the wake-up day, so "today" is the night that ended this morning.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-10-18` -> `18 Oct`. Calendar arithmetic on the string; no timezone is involved. */
export function sleepNightDateLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  return m && month ? `${Number(m[3])} ${month}` : date
}

export interface SleepCardNight<T extends { date: string }> {
  /** The night the card shows, or null when nothing recent enough exists. */
  night: T | null
  /** The caption for the card: names the night's date, or says which older night exists. */
  label: string
}

/**
 * Pick the card's night from `rows` (any order): the newest one dated `today` or the day before.
 * Anything older is stale and is not shown as if current; the label then says when the newest
 * recorded night was. Rows dated after `today` are ignored (a clock-skewed or mis-dated row).
 */
export function pickSleepCardNight<T extends { date: string }>(
  rows: readonly T[],
  today: string,
): SleepCardNight<T> {
  const yesterday = shiftDateStr(today, -1)
  let newest: T | null = null
  for (const row of rows) {
    if (row.date > today) continue
    if (!newest || row.date > newest.date) newest = row
  }
  if (newest && newest.date >= yesterday) {
    return { night: newest, label: `Night ending ${sleepNightDateLabel(newest.date)}` }
  }
  return {
    night: null,
    label: newest ? `Last recorded ${sleepNightDateLabel(newest.date)}` : 'No night recorded',
  }
}
