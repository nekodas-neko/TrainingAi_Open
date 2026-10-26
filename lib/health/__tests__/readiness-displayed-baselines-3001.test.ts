// #3001: the HRV and resting-HR baselines the readiness payload shows, and the 7-day means beside
// them, are of the device that measured the newest night (the rule of #2991). Oura's HRV and resting
// HR are different measurements from the ring's, so a baseline pooled across the switch is neither's.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TZ = 'Australia/Brisbane'

const repo = {
  listBodyMetrics: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  listSleepSessions: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getWorkoutSessionsFrom: vi.fn(async (_u: string, _f: Date) => [] as unknown[]),
  getOuraDaily: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getActiveProgram: vi.fn(async (_u: string) => null as unknown),
  listProgramPhases: vi.fn(async (_u: string, _p: string) => [] as unknown[]),
  countSessionsSinceStart: vi.fn(async (_u: string, _p: string) => 0),
  getHrForWindow: vi.fn(async (_u: string, _f: Date, _t: Date) => [] as unknown[]),
  getOuraDailySummary: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getOuraDailyDerived: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getLatestOuraCloudVitals: vi.fn(async (_u: string) => null),
  getMoodLog: vi.fn(async (_u: string, _d: string) => null),
  getUserById: vi.fn(async (_u: string) => ({ timezone: TZ, dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180 })),
  getUserGoals: vi.fn(async (_u: string) => ({ stepsGoal: null })),
  upsertOuraDailyDerived: vi.fn(async () => undefined),
  upsertOuraDailySummary: vi.fn(async () => undefined),
}

vi.mock('@/lib/data', () => ({
  getRepository: async () => repo,
  getRepositoryAsync: async () => repo,
}))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const dayIso = (daysAgo: number) => shiftDateStr(todayInTz(TZ), -daysAgo)

/** `ouraNights` newest nights from Oura Cloud, the 20 before them from the ring. */
const history = (ouraNights: number) => Array.from({ length: ouraNights + 20 }, (_, i) => {
  const oura = i < ouraNights
  return {
    date: dayIso(i), hrvMs: oura ? 70 : 45, restingHeartRate: oura ? 58 : 50,
    hrvSource: oura ? 'oura_cloud' : 'oura_ble', restingHeartRateSource: oura ? 'oura_cloud' : 'oura_ble',
    steps: 8000, activeCalories: 400, weightKg: 80,
  }
})

beforeEach(() => {
  for (const fn of Object.values(repo)) (fn as { mockClear: () => void }).mockClear()
  repo.listSleepSessions.mockResolvedValue([])
  repo.getOuraDaily.mockResolvedValue([])
  repo.getOuraDailySummary.mockResolvedValue([])
  repo.getOuraDailyDerived.mockResolvedValue([])
})

describe('the baselines the readiness payload shows, per device (#3001)', () => {
  it('reads as not yet known while the device in use has fewer than 5 nights, never the ring\u2019s', async () => {
    repo.listBodyMetrics.mockResolvedValue(history(4))
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.baselineHrv).toBeNull()          // pooled would show ~50
    expect(out.restingHrBaseline).toBeNull()    // pooled would show ~51
  })

  it('shows the device\u2019s own baseline and week once it has the nights, with no ring nights in it', async () => {
    repo.listBodyMetrics.mockResolvedValue(history(6))
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.baselineHrv).toBe(70)
    expect(out.restingHrBaseline).toBe(58)
    expect(out.restingHr).toBe(58)
  })

  it('is unchanged for the ring alone', async () => {
    repo.listBodyMetrics.mockResolvedValue(history(0))
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.baselineHrv).toBe(45)
    expect(out.restingHrBaseline).toBe(50)
  })
})
