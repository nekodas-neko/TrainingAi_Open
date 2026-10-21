// #3216 — the running plan and the cardio week took "the latest" resting HR with
// `[...rows].reverse().find(...)`, which is the latest only when rows arrive oldest first. Postgres
// `listBodyMetrics` returns `date DESC`, so both read the OLDEST reading in their window. The owner
// chose the 28-day mean for both (option A, `resting-hr-mean-3216.test.ts`); this picker stays for
// readiness, whose own last-night pick is unchanged.
import { describe, it, expect } from 'vitest'
import { latestRestingHr, latestRestingHrRow } from '../latest-resting-hr'
import { todayInTz, shiftDateStr } from '../../date-utils'

const TZ = 'Australia/Brisbane'
const row = (date: string, restingHeartRate: number | null) => ({ date, restingHeartRate })

// Days back from today, so no fixture pins one side of a rolling window.
const today = todayInTz(TZ)
const daysAgo = (n: number) => shiftDateStr(today, -n)

// date DESC, as `listBodyMetrics` returns it: newest first, oldest last.
const desc = [row(daysAgo(1), 52), row(daysAgo(10), 55), row(daysAgo(40), 58), row(daysAgo(85), 63)]

describe('latestRestingHr (#3216)', () => {
  it('picks the newest reading from DESC rows, where reverse().find() picked the oldest', () => {
    expect(latestRestingHr(desc)).toBe(52)
    expect([...desc].reverse().find(m => m.restingHeartRate != null)?.restingHeartRate).toBe(63)
  })

  it('agrees for ASC and shuffled rows', () => {
    expect(latestRestingHr([...desc].reverse())).toBe(52)
    expect(latestRestingHr([desc[2], desc[0], desc[3], desc[1]])).toBe(52)
  })

  it('skips null and non-positive readings, as readiness always has', () => {
    expect(latestRestingHr([row(daysAgo(0), 0), row(daysAgo(1), null), row(daysAgo(2), -1), row(daysAgo(3), 54)])).toBe(54)
    expect(latestRestingHrRow([row(daysAgo(0), 0), row(daysAgo(3), 54)])).toEqual(row(daysAgo(3), 54))
  })

  it('is null when nothing in the window qualifies', () => {
    expect(latestRestingHr([])).toBeNull()
    expect(latestRestingHr([row(daysAgo(1), null), row(daysAgo(2), 0)])).toBeNull()
  })
})
