// #3216, option A (owner, 21 Oct): the running plan and the cardio week build HR zones from the
// 28-day resting-HR mean, the value `resolveHrProfile` counts zone minutes with. Before, both read
// the OLDEST reading in their window; the first cut of this fix read the newest single night.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { meanRestingHr, restingHrWindow, RESTING_HR_WINDOW_DAYS } from '../resting-hr-mean'
import { resolveHrProfile } from '../hr-profile'
import { EMPTY_OBSERVED_HR } from '../observed-hr'
import { DEFAULT_RESTING_HR } from '../hr-zones'
import { resolveSnapshot } from '../../running/assemble-plan-context'
import { todayInTz, shiftDateStr } from '../../date-utils'

const TZ = 'Australia/Brisbane'
const row = (date: string, restingHeartRate: number | null) => ({ date, restingHeartRate })

// Days back from today, so no fixture pins one side of a rolling window.
const today = todayInTz(TZ)
const daysAgo = (n: number) => shiftDateStr(today, -n)

// date DESC, as `listBodyMetrics` returns it. Mean 55; newest 52, oldest 58.
const desc = [row(daysAgo(1), 52), row(daysAgo(5), 54), row(daysAgo(12), 56), row(daysAgo(27), 58)]

// Serves whatever rows it was given for any window, and records the windows asked for.
function repoWith(metrics: unknown[]) {
  const windows: [string, string][] = []
  const repo = {
    getUserById: async () => ({ dateOfBirth: null }),
    listBodyMetrics: async (_u: string, from: string, to: string) => { windows.push([from, to]); return metrics },
    getObservedHrProfile: async () => EMPTY_OBSERVED_HR,
    listFitnessTests: async () => [],
  } as never
  return { repo, windows }
}

describe('meanRestingHr (#3216)', () => {
  it('is the rounded mean of the measured readings', () => {
    expect(meanRestingHr(desc)).toBe(55)
    expect(meanRestingHr([row(daysAgo(1), 50), row(daysAgo(2), 51)])).toBe(51) // 50.5 rounds up
  })

  it('does not depend on row order', () => {
    expect(meanRestingHr([...desc].reverse())).toBe(55)
    expect(meanRestingHr([desc[2], desc[0], desc[3], desc[1]])).toBe(55)
  })

  it('skips null and non-positive readings', () => {
    expect(meanRestingHr([...desc, row(daysAgo(2), 0), row(daysAgo(3), null), row(daysAgo(4), -1)])).toBe(55)
  })

  it('is null when nothing qualifies', () => {
    expect(meanRestingHr([])).toBeNull()
    expect(meanRestingHr([row(daysAgo(1), null), row(daysAgo(2), 0)])).toBeNull()
  })

  // One outlier night among n readings moves the mean by (outlier − mean) / (n + 1), plus at most
  // half a bpm of rounding. The newest-night pick would have moved the whole way.
  it('moves by no more than an outlier night\'s share of the mean', () => {
    const steady = Array.from({ length: 27 }, (_, i) => row(daysAgo(i + 1), 55))
    const outlier = 85
    const withOutlier = [row(daysAgo(0), outlier), ...steady]
    const share = (outlier - 55) / withOutlier.length
    expect(Math.abs(meanRestingHr(withOutlier)! - meanRestingHr(steady)!)).toBeLessThanOrEqual(share + 0.5)
    expect(meanRestingHr(withOutlier)).toBe(56)
  })
})

describe('restingHrWindow', () => {
  it('is today and the 28 days before it, on the date string', () => {
    expect(RESTING_HR_WINDOW_DAYS).toBe(28)
    expect(restingHrWindow(today)).toEqual({ from: daysAgo(28), to: today })
  })
})

describe('the plan\'s resting HR is the zone-minute profile\'s (#3216, option A)', () => {
  it('equals resolveHrProfile\'s resting HR for the same rows, over the same window', async () => {
    const plan = repoWith(desc)
    const profile = repoWith(desc)
    const snapshot = await resolveSnapshot(plan.repo, 'u', TZ)
    const hr = await resolveHrProfile(profile.repo, 'u', TZ)
    expect(snapshot.restingHr).toBe(55)
    expect(snapshot.restingHr).toBe(hr.restingHr)
    expect(plan.windows).toEqual(profile.windows)
    expect(plan.windows).toEqual([[daysAgo(28), today]])
  })

  it('does not depend on row order', async () => {
    for (const rows of [desc, [...desc].reverse(), [desc[2], desc[0], desc[3], desc[1]]]) {
      expect((await resolveSnapshot(repoWith(rows).repo, 'u', TZ)).restingHr).toBe(55)
    }
  })

  it('falls back to the default of 60 when the window has no reading', async () => {
    expect(DEFAULT_RESTING_HR).toBe(60)
    expect((await resolveSnapshot(repoWith([]).repo, 'u', TZ)).restingHr).toBe(DEFAULT_RESTING_HR)
    expect((await resolveSnapshot(repoWith([row(daysAgo(1), null), row(daysAgo(2), 0)]).repo, 'u', TZ)).restingHr)
      .toBe(DEFAULT_RESTING_HR)
    expect((await resolveHrProfile(repoWith([]).repo, 'u', TZ)).restingHr).toBe(DEFAULT_RESTING_HR)
  })
})

// The cardio-week route's `restingHr` is not observable through its response (it feeds only
// `weeklyBaseMinutes`, the 60-minute floor while baseline is null), so its wiring is asserted at
// source, alongside the plan's.
describe('no plan or cardio-week reader uses a single night (#3216)', () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

  it('the plan snapshot reads the mean', () => {
    const src = read('packages/shared/src/running/assemble-plan-context.ts')
    expect(src).toContain('meanRestingHr(metrics)')
    expect(src).not.toContain('latestRestingHr')
  })

  it('the cardio week reads the profile\'s mean', () => {
    const src = read('app/api/cardio-week/route.ts')
    expect(src).toContain('const restingHr = profile.restingHr')
    expect(src).not.toContain('latestRestingHr')
    expect(src).not.toMatch(/reverse\(\)\.find\([^)]*restingHeartRate/)
  })
})

// #3001: the zones' resting HR is the mean of the device that measured the newest night.
describe('meanRestingHr per device (#3001)', () => {
  const day = (i: number) => `2026-10-${String(i).padStart(2, '0')}`
  const nights = (from: number, n: number, bpm: number, source: string) =>
    Array.from({ length: n }, (_, i) => ({ date: day(from + i), restingHeartRate: bpm, restingHeartRateSource: source }))

  it('holds the ring’s mean while Oura has fewer than 14 nights, not a pooled one', () => {
    const rows = [...nights(1, 14, 52, 'oura_ble'), ...nights(15, 5, 58, 'oura_cloud')]
    expect(meanRestingHr(rows)).toBe(52)       // pooled would be 54
  })

  it('moves to Oura’s own mean once Oura has 14 nights', () => {
    const rows = [...nights(1, 14, 52, 'oura_ble'), ...nights(15, 14, 58, 'oura_cloud')]
    expect(meanRestingHr(rows)).toBe(58)
  })

  it('still gives a first-time user a mean from the few nights they have', () => {
    expect(meanRestingHr(nights(1, 3, 61, 'oura_cloud'))).toBe(61)
  })

  it('reads rows that name no device as one device, as before', () => {
    expect(meanRestingHr([{ restingHeartRate: 50 }, { restingHeartRate: 60 }, { restingHeartRate: 0 }])).toBe(55)
  })
})
