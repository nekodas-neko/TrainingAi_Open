// #3193: from the day the user switched to the Oura API, today's ring-derived stress and recovery are
// partial leftovers, so the payload serves Oura's and the `daytimeStress` chip reads Oura's. Before the
// switch, or with none, the ring's stand. Neither feeds a score, so readiness itself never moves.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'

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
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'

const today = () => todayInTz(TZ)
const chip = (out: Awaited<ReturnType<typeof buildReadinessPayload>>) =>
  out.availability?.find(a => a.metric === 'daytimeStress')?.state

describe("today's stress and recovery follow the switch day (#3193)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.getOuraCloudSwitchDay.mockResolvedValue(null)
    repo.listSleepSessions.mockResolvedValue([])
    repo.listBodyMetrics.mockResolvedValue([])
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

  it('a switch day passed in is used and not looked up again (#3206)', async () => {
    const out = await buildReadinessPayload('u1', TZ, today())
    expect(out.stressHigh).toBe(3_600)
    expect(repo.getOuraCloudSwitchDay).not.toHaveBeenCalled()
    expect((await buildReadinessPayload('u1', TZ, null)).stressHigh).toBe(1_800)
    expect(repo.getOuraCloudSwitchDay).not.toHaveBeenCalled()
  })

  it('a failed switch lookup reads as no switch', async () => {
    repo.getOuraCloudSwitchDay.mockRejectedValue(new Error('db down'))
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.stressHigh).toBe(1_800)
  })

  it('from the switch day, the ring\'s leftover resilience level is not offered (#3206)', async () => {
    repo.getOuraDailyDerived.mockResolvedValue([
      { day: shiftDateStr(today(), -2), resilienceLevel: 3, resilienceConfidence: 1 },
      { day: today(), resilienceLevel: 2, resilienceConfidence: 1 },
    ])
    expect((await buildReadinessPayload('u1', TZ)).ownResilienceAsOf).toBe(today())
    repo.getOuraCloudSwitchDay.mockResolvedValue(today())
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.ownResilienceAsOf).toBe(shiftDateStr(today(), -2))
    expect(out.ownResilienceLevel).toBe(3)
  })

  it('no score input changes: readiness, sleep and activity are the same either side of the switch', async () => {
    // Mature Oura-API nights and today's steps, so all three scores exist: with every score null on
    // both sides this test would pass even if stress fed one.
    const days = BASELINE_MIN_NIGHTS + 8
    const wakeDays = Array.from({ length: days }, (_, i) => shiftDateStr(today(), -(days - 1 - i)))
    const HOUR = 3_600_000
    repo.listSleepSessions.mockResolvedValue(wakeDays.map((d, i) => {
      const mid = dateStrMidnightInTz(d, TZ).getTime()
      return {
        id: `s${i}`, date: d, ouraId: `cloud-${d}`,
        sleepStart: new Date(mid - 1.5 * HOUR), sleepEnd: new Date(mid + 6.5 * HOUR),
        durationHours: 7.4, deepSleepHours: 1.4, remSleepHours: 1.6, lightSleepHours: 4.4, awakHours: 0.6,
        efficiency: 90, avgHrv: 50 + (i % 3), restingHeartRate: 52 + (i % 2), respiratoryRate: 14.5,
        durationSource: 'oura_cloud', respiratoryRateSource: 'oura_cloud',
      }
    }))
    repo.listBodyMetrics.mockResolvedValue(wakeDays.map((d, i) => ({
      date: d, hrvMs: 50 + (i % 3), restingHeartRate: 52 + (i % 2), steps: 9_000,
      hrvSource: 'oura_cloud', restingHeartRateSource: 'oura_cloud',
    })))

    const before = await buildReadinessPayload('u1', TZ)
    repo.getOuraCloudSwitchDay.mockResolvedValue(today())
    const after = await buildReadinessPayload('u1', TZ)

    expect(before.readinessDisplayScore).not.toBeNull()
    expect(before.sleepScore).not.toBeNull()
    expect(before.activityScore).not.toBeNull()
    expect(before.readinessContributors).not.toEqual({})
    // The switch moved the displayed stress, so the comparison below is across a real change.
    expect(after.stressHigh).not.toBe(before.stressHigh)
    expect(after.readinessDisplayScore).toBe(before.readinessDisplayScore)
    expect(after.sleepScore).toBe(before.sleepScore)
    expect(after.activityScore).toBe(before.activityScore)
    expect(after.readinessContributors).toEqual(before.readinessContributors)
  })
})
