// #3216 — the running plan and the cardio week took "the latest" resting HR with
// `[...rows].reverse().find(...)`, which is the latest only when rows arrive oldest first. Postgres
// `listBodyMetrics` returns `date DESC`, so both read the OLDEST reading in their window.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { latestRestingHr, latestRestingHrRow } from '../latest-resting-hr'
import { resolveSnapshot } from '../../running/assemble-plan-context'
import { DEFAULT_RESTING_HR } from '../hr-zones'
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

describe('resolveSnapshot reads the newest resting HR (#3216)', () => {
  const repoWith = (metrics: unknown[]) => ({
    getUserById: async () => ({ dateOfBirth: null }),
    listBodyMetrics: async () => metrics,
    listFitnessTests: async () => [],
  }) as never

  it('uses the newest of DESC rows', async () => {
    expect((await resolveSnapshot(repoWith(desc), 'u', TZ)).restingHr).toBe(52)
  })

  // Unchanged from before: no reading in the 90 days falls through to the default.
  it('falls back to the default when the window has no reading', async () => {
    expect((await resolveSnapshot(repoWith([]), 'u', TZ)).restingHr).toBe(DEFAULT_RESTING_HR)
    expect((await resolveSnapshot(repoWith([row(daysAgo(1), null)]), 'u', TZ)).restingHr).toBe(DEFAULT_RESTING_HR)
  })

  // Before, the plan path skipped only null, so a 0 reached resolveFitnessSnapshot — which already
  // replaced it with the default. Now the 0 is skipped and the next real reading wins.
  it('skips a zero for the next real reading rather than defaulting', async () => {
    expect((await resolveSnapshot(repoWith([row(daysAgo(0), 0), row(daysAgo(2), 54)]), 'u', TZ)).restingHr).toBe(54)
  })
})

// The cardio-week route's `restingHr` is not observable through its response (it feeds only
// `weeklyBaseMinutes`, which is the 60-minute floor while baseline is null), so its wiring is
// asserted at source, alongside the plan's.
describe('no reader keeps the positional idiom (#3216)', () => {
  const files = ['app/api/cardio-week/route.ts', 'packages/shared/src/running/assemble-plan-context.ts']
  for (const f of files) {
    it(`${f} reads resting HR through latestRestingHr`, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src).toContain('latestRestingHr(')
      expect(src).not.toMatch(/reverse\(\)\.find\([^)]*restingHeartRate/)
    })
  }
})
