// #3000 (scoring doc rule 5): Oura's top-level scores are never ours. The readiness payload feeds
// the Home chips, the Sleep hero, the Readiness detail and the native cards; with Oura's readiness,
// sleep and activity scores and contributors present and ours absent, none of Oura's reaches it.
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
  upsertOuraDailyDerived: vi.fn(async () => undefined),
  upsertOuraDailySummary: vi.fn(async () => undefined),
}

vi.mock('@/lib/data', () => ({
  getRepository: async () => repo,
  getRepositoryAsync: async () => repo,
}))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const ouraToday = () => ({
  date: todayInTz(TZ), readinessScore: 91, sleepScore: 87, activityScore: 83, daySummary: 'stressful',
  readinessContributors: { hrv_balance: 13 }, sleepContributors: { deep_sleep: 17 }, activityContributors: { move_every_hour: 19 },
})

describe("the readiness payload never carries Oura's scores as ours (#3000)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.getOuraDaily.mockResolvedValue([ouraToday()])
  })

  it("Oura's scores exist and ours don't → no score, never Oura's", async () => {
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.readinessDisplayScore).toBeNull()
    expect(out.sleepScore).toBeNull()
    expect(out.activityScore).not.toBe(83)
    expect(out.readinessContributors).toBeNull()
    expect(out.sleepContributors).toBeNull()
    expect(out.activityContributors).not.toEqual({ move_every_hour: 19 })
    expect(out).not.toHaveProperty('ouraScore')
    expect(out).not.toHaveProperty('daySummary')
    expect(JSON.stringify(out)).not.toMatch(/\b(91|87)\b|hrv_balance|deep_sleep|move_every_hour|stressful/)
  })

  it('our sleep score and contributors are the ones served', async () => {
    const d = todayInTz(TZ)
    repo.listSleepSessions.mockResolvedValue([{
      date: d, sleepStart: new Date(`${shiftDateStr(d, -1)}T12:30:00.000Z`), sleepEnd: new Date(`${d}T20:00:00.000Z`),
      durationHours: 7.5, deepSleepHours: 1.4, remSleepHours: 1.6, lightSleepHours: 4.2, awakHours: 0.3,
    }])
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.sleepScore).not.toBeNull()
    expect(out.sleepScore).not.toBe(87)
    expect(out.sleepContributors).not.toBeNull()
    // Our contributors share some of Oura's key names; the values are what must be ours.
    expect(out.sleepContributors?.deep_sleep).not.toBe(17)
  })
})
