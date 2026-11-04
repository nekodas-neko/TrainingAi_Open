// #3612 — the cardio week's resting-HR delta compares two means of the one resting-HR rule, each keyed
// by (source, the source's algorithm version) over sleep read for both windows. One version gives
// exactly the delta it gave before; a second version splits the current window's mean at the change.
// Synthetic values and generic source names only; dates are counted back from today.
import { describe, it, expect, vi } from 'vitest'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { EMPTY_OBSERVED_HR } from '@trainingai/shared/health/observed-hr'

const TZ = 'Australia/Brisbane'
const state = vi.hoisted(() => ({ sleep: [] as unknown[] | 'fails', user: 0 }))
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: `u-3612-${state.user}`, timezone: 'Australia/Brisbane' } }) }))

const today = todayInTz(TZ)
const daysAgo = (n: number) => shiftDateStr(today, -n)
/** 62 nights from `source_a`: 52 bpm up to 15 nights ago, 58 for the newest 15. */
const metrics = Array.from({ length: 62 }, (_, i) => {
  const back = 61 - i
  return { date: daysAgo(back), restingHeartRate: back >= 15 ? 52 : 58, restingHeartRateSource: 'source_a' }
})
const night = (back: number, version: string) => ({ date: daysAgo(back), durationSource: 'source_a', sourceAlgorithmVersion: version })

vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getZoneMinutesRange: async () => [],
    getObservedHrProfile: async () => EMPTY_OBSERVED_HR,
    getUserById: async () => ({ dateOfBirth: '1990-01-01' }),
    listFitnessTests: async () => [],
    listBodyMetrics: async (_u: string, from: string, to: string) => metrics.filter(m => m.date >= from && m.date <= to),
    listSleepSessions: async (_u: string, from: string, to: string) => {
      if (state.sleep === 'fails') throw new Error('sleep read failed')
      return (state.sleep as { date: string }[]).filter(s => s.date >= from && s.date <= to)
    },
    getActiveRunningPlan: async () => null,
    getDayExerciseNames: async () => [],
    listActivityLogs: async () => [],
    getUserGoals: async () => ({ stepsGoal: null }),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET } from '@/app/api/cardio-week/route'

async function week(sleep: unknown[] | 'fails') {
  state.sleep = sleep
  state.user++
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const res = await GET()
  spy.mockRestore()
  expect(res.status).toBe(200)
  return res.json() as Promise<Record<string, unknown>>
}
const delta = (body: Record<string, unknown>) => (body.heart as { restingHrDeltaBpm: number | null }).restingHrDeltaBpm

describe('the cardio week keys its resting-HR means by algorithm version (#3612)', () => {
  it('one version gives exactly what no version gave', async () => {
    const before = await week([])
    const after = await week(Array.from({ length: 62 }, (_, back) => night(back, '1.0')))
    expect(delta(before)).toBe(3) // 55 now, pooled over the change, against 52 a month before
    expect(after).toEqual(before)
  })

  it('two versions split at the change', async () => {
    const body = await week(Array.from({ length: 62 }, (_, back) => night(back, back >= 15 ? '1.0' : '2.0')))
    expect(delta(body)).toBe(6) // the new version's own 58 against the previous month's 52
  })

  it('a failed sleep read keys the means by source only, as before', async () => {
    expect(delta(await week('fails'))).toBe(3)
  })
})
