// Q-43: a user with no ring has no oura_daily (Cloud) and no oura_daily_summary (BLE rollup), so
// the readiness composite never ran and every score surface rendered blank. These pin the three
// boundaries: nothing at all → no score and no fabricated one; generic tables only → a real,
// explicitly-limited score; the ring's own inputs → byte-for-byte what it produced before.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateBaseline, type Baseline } from '@trainingai/shared/health/personal-baseline'

const TZ = 'Australia/Brisbane'

const repo = vi.hoisted(() => ({
  bodyMetrics: [] as Record<string, unknown>[],
  sleepSessions: [] as Record<string, unknown>[],
  ouraDaily: [] as Record<string, unknown>[],
  dailySummaries: [] as Record<string, unknown>[],
  derived: [] as Record<string, unknown>[],
  upsertDerived: vi.fn(),
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listBodyMetrics:         async () => repo.bodyMetrics,
    listSleepSessions:       async () => repo.sleepSessions,
    getWorkoutSessionsFrom:  async () => [],
    getOuraDaily:            async () => repo.ouraDaily,
    getActiveProgram:        async () => null,
    getHrForWindow:          async () => [],
    getOuraDailySummary:     async () => repo.dailySummaries,
    getOuraDailyDerived:     async () => repo.derived,
    getLatestOuraCloudVitals: async () => null,
    getMoodLog:              async () => null,
    getUserById:             async () => ({ id: 'u1', dateOfBirth: '1995-01-01', heightCm: 180, sex: 'male', activityLevel: 'moderate' }),
    upsertOuraDailyDerived:  repo.upsertDerived,
  }),
}))

import { GET } from '@/app/api/readiness-score/route'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const today = todayInTz(TZ)
const day = (back: number) => shiftDateStr(today, -back)

/** N days of body metrics ending today, newest first (listBodyMetrics is date-descending). */
function bodyHistory(days: number, opts: { hrv?: boolean; rhr?: boolean } = {}) {
  return Array.from({ length: days }, (_, i) => ({
    date: day(i),
    hrvMs: opts.hrv ? 55 + (i % 5) : undefined,
    restingHeartRate: opts.rhr ? 52 + (i % 4) : undefined,
    steps: 8000,
    activeCalories: 400,
    weightKg: 80,
  }))
}

/** N nights of ~7.5 h sleep ending last night. */
function sleepHistory(days: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = day(i)
    return {
      date: d,
      sleepStart: new Date(`${day(i + 1)}T12:30:00.000Z`),  // 22:30 local
      sleepEnd:   new Date(`${d}T20:00:00.000Z`),           // 06:00 local
      durationHours: 7.5,
      deepSleepHours: 1.4,
      remSleepHours: 1.6,
      lightSleepHours: 4.2,
      awakHours: 0.3,
    }
  })
}

async function call() {
  const res = await GET()
  return await res.json()
}

beforeEach(() => {
  repo.bodyMetrics = []
  repo.sleepSessions = []
  repo.ouraDaily = []
  repo.dailySummaries = []
  repo.derived = []
  repo.upsertDerived.mockReset()
})

describe('GET /api/readiness-score — degradation for non-ring users', () => {
  it('shows no readiness and claims no inputs when there is nothing to score', async () => {
    const d = await call()
    expect(d.readinessDisplayScore).toBeNull()
    expect(d.hasSufficientData).toBe(false)
    expect(d.source).toBe('none')
    expect(d.limited).toBe(true)
    expect(d.scoreConfidence).toBe('minimal')
    expect(d.inputsAvailable).toEqual([])
    expect(repo.upsertDerived).not.toHaveBeenCalled()
  })

  it('produces a real readiness from the generic tables alone, flagged limited', async () => {
    repo.bodyMetrics = bodyHistory(21, { hrv: true, rhr: true })
    repo.sleepSessions = sleepHistory(21)

    const d = await call()
    expect(d.readinessDisplayScore).toBeGreaterThan(0)
    expect(d.readinessDisplayScore).toBeLessThanOrEqual(100)
    expect(d.hasSufficientData).toBe(true)
    expect(d.readinessCompositeContributors).not.toBeNull()
    // No skin-temperature source without a ring, so it can never read 'full'.
    expect(d.limited).toBe(true)
    expect(d.scoreConfidence).toBe('partial')
    expect(d.inputsMissing).toContain('temperature')
    expect(d.inputsAvailable).toEqual(expect.arrayContaining(['sleep', 'hrv', 'restingHeartRate']))
  })

  it('persists that readiness under today so the trend surfaces stop reading empty', async () => {
    repo.bodyMetrics = bodyHistory(21, { hrv: true, rhr: true })
    repo.sleepSessions = sleepHistory(21)
    await call()

    const readinessWrite = repo.upsertDerived.mock.calls.find(c => c[2]?.readinessScore != null)
    expect(readinessWrite).toBeDefined()
    expect(readinessWrite![1]).toBe(today)
    expect(readinessWrite![2].readinessSource).toBe('generic-derived')
  })

  it('scores sleep-only history without inventing recovery signals it does not have', async () => {
    repo.sleepSessions = sleepHistory(21)

    const d = await call()
    expect(d.sleepScore).toBeGreaterThan(0)
    expect(d.readinessDisplayScore).not.toBeNull()
    expect(d.scoreConfidence).toBe('minimal')
    expect(d.inputsMissing).toEqual(expect.arrayContaining(['hrv', 'restingHeartRate', 'temperature']))
    // Contributors with no input stay at the composite's neutral rather than being filled in.
    expect(d.readinessCompositeContributors.hrvBalance.provisional).toBe(true)
    expect(d.readinessCompositeContributors.restingHeartRate.provisional).toBe(true)
  })

  it('leaves a ring user unchanged — the rollup composite still wins and reads full', async () => {
    repo.bodyMetrics = bodyHistory(21, { hrv: true, rhr: true })
    repo.sleepSessions = sleepHistory(21)
    let rhrBaseline: Baseline | null = null
    let hrvBaseline: Baseline | null = null
    let sleepBaseline: Baseline | null = null
    for (let i = 0; i < 20; i++) {
      rhrBaseline = updateBaseline(rhrBaseline, 52, i)
      hrvBaseline = updateBaseline(hrvBaseline, 57, i)
      sleepBaseline = updateBaseline(sleepBaseline, 450, i)
    }
    const summary = (date: string) => ({
      date, nHistory: 20,
      sleepDurationHours: 7.5, sleepEfficiency: 92,
      rhrLowBpm: 51, hrvAvgMs: 60, tempMeanC: 36.4, breathAvgRpm: 14,
      tempDevC: 0.1, recoveryIndexHours: 6,
      rhrBaseline, hrvBaseline, sleepBaseline, tempBaseline: null, breathBaseline: null,
    })
    repo.dailySummaries = [summary(day(1)), summary(day(0))]

    const d = await call()
    expect(d.source).toBe('custom')
    expect(d.readinessDisplayScore).not.toBeNull()
    // The rollup path keys its persist on the summary's wake day, not today, and tags its source.
    const readinessWrite = repo.upsertDerived.mock.calls.find(c => c[2]?.readinessScore != null)
    expect(readinessWrite![1]).toBe(day(0))
    expect(readinessWrite![2].readinessSource).toBe('ble-derived')
  })

  it('reports full and unlimited when a cloud readiness score is present', async () => {
    repo.ouraDaily = [{ date: today, readinessScore: 82, temperatureDeviation: 0.1, nonWearTimeSec: 3600 }]

    const d = await call()
    expect(d.ouraScore).toBe(82)
    expect(d.limited).toBe(false)
    expect(d.scoreConfidence).toBe('full')
    expect(d.inputsMissing).toEqual([])
  })
})
