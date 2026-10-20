// #3193: from the day the user switched to the Oura API, today's ring-derived stress and recovery are
// partial leftovers, so the payload serves Oura's and the `daytimeStress` chip reads Oura's. Before the
// switch, or with none, the ring's stand. Neither feeds a score, so readiness itself never moves.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TZ = 'Australia/Brisbane'

const repo = {
  listBodyMetrics: vi.fn(async () => [] as unknown[]),
  listSleepSessions: vi.fn(async () => [] as unknown[]),
  getWorkoutSessionsFrom: vi.fn(async () => [] as unknown[]),
  getOuraDaily: vi.fn(async () => [] as unknown[]),
  getActiveProgram: vi.fn(async () => null as unknown),
  listProgramPhases: vi.fn(async () => [] as unknown[]),
  countSessionsSinceStart: vi.fn(async () => 0),
  getHrForWindow: vi.fn(async () => [] as unknown[]),
  getOuraDailySummary: vi.fn(async () => [] as unknown[]),
  getOuraDailyDerived: vi.fn(async () => [] as unknown[]),
  getLatestOuraCloudVitals: vi.fn(async () => null),
  getMoodLog: vi.fn(async () => null),
  getUserById: vi.fn(async () => ({ timezone: TZ, dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180 })),
  getUserGoals: vi.fn(async () => ({ stepsGoal: null })),
  getOuraCloudSwitchDay: vi.fn(async () => null as string | null),
  upsertOuraDailyDerived: vi.fn(async () => undefined),
  upsertOuraDailySummary: vi.fn(async () => undefined),
}

vi.mock('@/lib/data', () => ({
  getRepository: async () => repo,
  getRepositoryAsync: async () => repo,
}))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const today = () => todayInTz(TZ)
const chip = (out: Awaited<ReturnType<typeof buildReadinessPayload>>) =>
  out.availability?.find(a => a.metric === 'daytimeStress')?.state

describe("today's stress and recovery follow the switch day (#3193)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.getOuraDailyDerived.mockResolvedValue([{ day: today(), stressHighMinutes: 30, recoveryHighMinutes: 20 }])
    repo.getOuraDaily.mockResolvedValue([{ date: today(), stressHigh: 3_600, recoveryHigh: 1_800 }])
  })

  it('with no switch, the ring stands', async () => {
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.stressHigh).toBe(1_800)
    expect(out.recoveryHigh).toBe(1_200)
    expect(chip(out)).toBe('present')
  })

  it('before the switch day, the ring stands', async () => {
    repo.getOuraCloudSwitchDay.mockResolvedValue(shiftDateStr(today(), 1))
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.stressHigh).toBe(1_800)
    expect(out.recoveryHigh).toBe(1_200)
  })

  it("from the switch day, Oura's is served over the ring's", async () => {
    repo.getOuraCloudSwitchDay.mockResolvedValue(today())
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.stressHigh).toBe(3_600)
    expect(out.recoveryHigh).toBe(1_800)
    expect(chip(out)).toBe('present')
  })

  it('from the switch day with nothing from Oura, the chip is absent rather than the ring leftover', async () => {
    repo.getOuraCloudSwitchDay.mockResolvedValue(shiftDateStr(today(), -3))
    repo.getOuraDaily.mockResolvedValue([])
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.stressHigh).toBeNull()
    expect(chip(out)).toBe('absent')
  })

  it('a failed switch lookup reads as no switch', async () => {
    repo.getOuraCloudSwitchDay.mockRejectedValue(new Error('db down'))
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.stressHigh).toBe(1_800)
  })

  it('no score input changes: readiness, sleep and activity are the same either side of the switch', async () => {
    const before = await buildReadinessPayload('u1', TZ)
    repo.getOuraCloudSwitchDay.mockResolvedValue(today())
    const after = await buildReadinessPayload('u1', TZ)
    expect(after.readinessDisplayScore).toBe(before.readinessDisplayScore)
    expect(after.sleepScore).toBe(before.sleepScore)
    expect(after.activityScore).toBe(before.activityScore)
    expect(after.readinessContributors).toEqual(before.readinessContributors)
  })
})
