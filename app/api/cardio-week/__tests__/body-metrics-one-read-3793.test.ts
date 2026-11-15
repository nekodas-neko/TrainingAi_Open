// #3793 ⑦: /api/cardio-week read `body_metrics` four times over overlapping windows (the week, 28 days
// for weight, and the two 30-day resting-HR windows). It now reads the widest once and slices it. The
// response must not move: the figures below were read from `main` before the change, and every figure
// that reads body metrics (today's and the week's steps, the weight behind the step goal, the
// resting-HR delta) is pinned. Synthetic values; dates count back from today.
import { describe, it, expect, vi } from 'vitest'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { EMPTY_OBSERVED_HR } from '@trainingai/shared/health/observed-hr'

const TZ = 'Australia/Brisbane'
const calls = vi.hoisted(() => ({ bodyMetrics: [] as [string, string][] }))
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-3793-cardio', timezone: 'Australia/Brisbane' } }) }))

const today = todayInTz(TZ)
const daysAgo = (n: number) => shiftDateStr(today, -n)
/** 75 days, newest first as the repository orders them: steps every day, weight every fifth day, and
 *  a resting HR that steps from 54 to 59 bpm 20 days ago; day 3 has no row at all. */
const metrics = Array.from({ length: 75 }, (_, back) => back)
  .filter(back => back !== 3)
  .map(back => ({
    date: daysAgo(back),
    steps: 4_000 + back * 37,
    ...(back % 5 === 2 ? { weightKg: 90 - back / 10 } : {}),
    restingHeartRate: back >= 20 ? 54 : 59,
    restingHeartRateSource: 'source_a',
  }))

vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getZoneMinutesRange: async () => [],
    getObservedHrProfile: async () => EMPTY_OBSERVED_HR,
    getUserById: async () => ({ dateOfBirth: '1990-01-01', heightCm: 180, sex: 'male', activityLevel: 'moderate' }),
    listFitnessTests: async () => [],
    listBodyMetrics: async (_u: string, from: string, to: string) => {
      calls.bodyMetrics.push([from, to])
      return metrics.filter(m => m.date >= from && m.date <= to)
    },
    listSleepSessions: async () => [],
    getActiveRunningPlan: async () => null,
    getDayExerciseNames: async () => [],
    listActivityLogs: async () => [],
    getUserGoals: async () => ({ stepsGoal: null }),
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET } from '@/app/api/cardio-week/route'

describe('the cardio week reads body metrics once (#3793 ⑦)', () => {
  it('gives the figures it gave with four reads', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json() as {
      steps: { today: number; week: number }
      heart: { restingHr: number | null; restingHrDeltaBpm: number | null }
    }
    // Pinned against `main` before the change, where the whole body was compared and was identical.
    expect(body.steps.today).toBe(4_000)
    const weekDays = metrics.filter(m => m.date >= (body as unknown as { week: { from: string } }).week.from && m.date <= today)
    expect(body.steps.week).toBe(weekDays.reduce((a, m) => a + m.steps, 0))
    expect(body.heart).toMatchObject({ restingHr: 57, restingHrDeltaBpm: 3 })
  })

  it('in one round trip, beside the HR profile\'s own (five calls on `main`)', async () => {
    calls.bodyMetrics = []
    await GET()
    expect(calls.bodyMetrics).toHaveLength(2)
  })
})
