// #3824: the "vs your 14-day average" chip averages readiness on one scale. The trends route gives
// each day's readiness converted onto the current scale beside the stored number the sparkline shows.
import { describe, it, expect, vi } from 'vitest'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { READINESS_MODEL_VERSION } from '@trainingai/shared/health/readiness-composite'
import { scoreAverageChip } from '@trainingai/shared/health/score-average-chip'

const TZ = 'Australia/Brisbane'
const today = todayInTz(TZ)
const d = (n: number) => shiftDateStr(today, -n)
const atBaseline = (s: number) => ({
  restingHeartRate: { score: s, input: 0, provisional: false, gap: null },
  hrvBalance: { score: s, input: 0, provisional: false, gap: null },
  sleepBalance: { score: s, input: 0, provisional: false, gap: null },
})

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDaily: async () => [],
    getOuraDailyDerived: async () => [
      // Before release: an ordinary day stored as 55 on the old scale.
      { day: d(3), readinessSource: 'ble-derived', readinessScore: 55, modelVersions: { readiness: 'v17:version-keyed-baselines:2026-11-04' }, readinessContributors: atBaseline(50) },
      { day: d(2), readinessSource: 'ble-derived', readinessScore: 55, modelVersions: { readiness: 'v17:version-keyed-baselines:2026-11-04' }, readinessContributors: atBaseline(50) },
      // An old row with no contributor map cannot be converted.
      { day: d(4), readinessSource: 'ble-derived', readinessScore: 30, modelVersions: null, readinessContributors: null },
      // After release: the same ordinary day reads 66.
      { day: d(1), readinessSource: 'ble-derived', readinessScore: 66, modelVersions: { readiness: READINESS_MODEL_VERSION }, readinessContributors: atBaseline(75) },
    ],
    listBodyMetrics: async () => [],
    getWorkoutSessionsFrom: async () => [],
    listActivityLogs: async () => [],
  }),
}))

import { GET } from '@/app/api/health/trends/route'

describe('health trends: readiness on the current scale (#3824)', () => {
  it('gives each day its converted score beside the stored one', async () => {
    const { trends } = await (await GET()).json() as { trends: { date: string; readinessScore: number | null; readinessScoreCurrentScale: number | null }[] }
    const by = Object.fromEntries(trends.map(t => [t.date, t]))
    expect(by[d(3)]).toMatchObject({ readinessScore: 55, readinessScoreCurrentScale: 66 })
    expect(by[d(1)]).toMatchObject({ readinessScore: 66, readinessScoreCurrentScale: 66 })
    expect(by[d(4)]).toMatchObject({ readinessScore: 30, readinessScoreCurrentScale: null })

    // The chip a v18 ordinary day gets: level with the past days, not "+11".
    const prior = trends.filter(t => t.date < today).map(t => t.readinessScoreCurrentScale)
    expect(scoreAverageChip(66, prior)?.diff).toBe(0)
  })
})
