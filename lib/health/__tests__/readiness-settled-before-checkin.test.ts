// #2224 (TN-9). The owner, 2026-08-26: *"we shouldn't have readiness move the number — the numbers
// should be fully set on first open/load."* The morning check-in is answered after that first open,
// and it used to carry 10% of readiness, so answering it moved a score already read. The issue's pass
// test is this one: the same day, served before and after a check-in is logged, is identical.
//
// Driven through the real `buildReadinessPayload`, because the composite no longer has a check-in
// input at all and a test there would be checking a type. The question is whether anything on the
// served path still reads the check-in.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BASELINE_MIN_NIGHTS } from '@trainingai/shared/health/readiness-composite'

const repo = {
  listBodyMetrics: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  listSleepSessions: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getWorkoutSessionsFrom: vi.fn(async (_u: string, _f: Date) => [] as unknown[]),
  getOuraDaily: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getActiveProgram: vi.fn(async (_u: string) => null),
  getHrForWindow: vi.fn(async (_u: string, _f: Date, _t: Date) => [] as unknown[]),
  getOuraDailySummary: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getOuraDailyDerived: vi.fn(async (_u: string, _f: string, _t: string) => [] as unknown[]),
  getLatestOuraCloudVitals: vi.fn(async (_u: string) => null),
  getMoodLog: vi.fn(async (_u: string, _d: string) => null as unknown),
  getUserById: vi.fn(async (_u: string) => ({ timezone: 'Australia/Brisbane', dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180 })),
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

const TZ = 'Australia/Brisbane'
const dayIso = (daysAgo: number) => shiftDateStr(todayInTz(TZ), -daysAgo)

// Enough history for the generic composite to score with mature baselines: no ring needed.
const history = (days: number) => Array.from({ length: days }, (_, i) => ({
  date: dayIso(days - 1 - i),
  restingHeartRate: 54 + (i % 3),
  hrvMs: 62 + (i % 5),
}))

const pumped = {
  id: 'm1', userId: 'u1', date: todayInTz(TZ), energyLevel: 'pumped', sleepQuality: 'great',
  bodyState: [], soreMuscles: [], createdAt: new Date(),
}

beforeEach(() => {
  for (const fn of Object.values(repo)) (fn as { mockClear: () => void }).mockClear()
  repo.listBodyMetrics.mockResolvedValue(history(BASELINE_MIN_NIGHTS + 6))
  repo.getMoodLog.mockResolvedValue(null)
})

describe('readiness is settled before the check-in is answered (#2224)', () => {
  it('serves the same score and contributors with and without a logged check-in', async () => {
    const before = await buildReadinessPayload('u1', TZ)
    repo.getMoodLog.mockResolvedValue(pumped)
    const after = await buildReadinessPayload('u1', TZ)

    // A control: a payload with no readiness at all would pass the comparisons below vacuously.
    expect(before.readinessDisplayScore).not.toBeNull()

    expect(after.readinessDisplayScore).toBe(before.readinessDisplayScore)
    expect(after.readinessCompositeContributors).toEqual(before.readinessCompositeContributors)
    expect(after.inputsAvailable).toEqual(before.inputsAvailable)
    expect(after.inputsMissing).toEqual(before.inputsMissing)
  })

  it('does not read the check-in at all', async () => {
    await buildReadinessPayload('u1', TZ)
    expect(repo.getMoodLog).not.toHaveBeenCalled()
  })
})
