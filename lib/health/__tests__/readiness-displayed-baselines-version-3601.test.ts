// #3601: the HRV and resting-HR baselines the readiness payload shows, and the 7-day means beside them,
// are of the newest reading's (source, algorithm version), the version read from the same night's
// sleep. Same harness as readiness-displayed-baselines-3001.test.ts; synthetic values only.
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

const SRC = 'source_a'
const MS_H = 3_600_000
/** `n` nights of `source_a`, newest first: the newest `newNights` read 70 ms / 58 bpm, the rest 45 / 50. */
const metrics = (n: number, newNights: number) => Array.from({ length: n }, (_, i) => {
  const isNew = i < newNights
  return {
    date: dayIso(i), hrvMs: isNew ? 70 : 45, restingHeartRate: isNew ? 58 : 50,
    hrvSource: SRC, restingHeartRateSource: SRC, steps: 8000, activeCalories: 400, weightKg: 80,
  }
})
/** The night ending on each date, its version `newVersion` for the newest `newNights` and `oldVersion` before. */
const sleep = (n: number, newNights: number, newVersion: string, oldVersion: string) => Array.from({ length: n }, (_, i) => {
  const end = new Date(`${dayIso(i)}T06:30:00+10:00`)
  return {
    id: `s${i}`, userId: 'u1', date: dayIso(i), sleepStart: new Date(end.getTime() - 8 * MS_H), sleepEnd: end,
    durationHours: 7.5, deepSleepHours: 1.5, remSleepHours: 1.5, lightSleepHours: 4.5, awakHours: 0.5,
    createdAt: end, durationSource: SRC, respiratoryRateSource: SRC,
    sourceAlgorithmVersion: i < newNights ? newVersion : oldVersion,
  }
})

beforeEach(() => {
  for (const fn of Object.values(repo)) (fn as { mockClear: () => void }).mockClear()
  repo.getOuraDaily.mockResolvedValue([])
  repo.getOuraDailySummary.mockResolvedValue([])
  repo.getOuraDailyDerived.mockResolvedValue([])
  repo.listBodyMetrics.mockResolvedValue(metrics(26, 6))
})

describe('the readiness payload’s baselines, keyed by algorithm version (#3601)', () => {
  it('one version: the same baselines and week as with no version stored', async () => {
    repo.listSleepSessions.mockResolvedValue([])
    const before = await buildReadinessPayload('u1', TZ)
    repo.listSleepSessions.mockResolvedValue(sleep(26, 6, '1', '1'))
    const after = await buildReadinessPayload('u1', TZ)
    expect(after.baselineHrv).toBe(before.baselineHrv)
    expect(after.recentHrv).toBe(before.recentHrv)
    expect(after.restingHrBaseline).toBe(before.restingHrBaseline)
    expect(after.restingHr).toBe(before.restingHr)
    expect(after.baselineHrv).not.toBe(70)       // pooled across the two stretches
  })

  it('two versions: the baselines and the week are the new version’s own', async () => {
    repo.listSleepSessions.mockResolvedValue(sleep(26, 6, '2', '1'))
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.baselineHrv).toBe(70)
    expect(out.recentHrv).toBe(70)
    expect(out.restingHrBaseline).toBe(58)
    expect(out.restingHr).toBe(58)
  })

  it('two versions, the new one under 5 nights: the baselines are not yet known', async () => {
    repo.listBodyMetrics.mockResolvedValue(metrics(26, 4))
    repo.listSleepSessions.mockResolvedValue(sleep(26, 4, '2', '1'))
    const out = await buildReadinessPayload('u1', TZ)
    expect(out.baselineHrv).toBeNull()
    expect(out.restingHrBaseline).toBeNull()
  })
})
