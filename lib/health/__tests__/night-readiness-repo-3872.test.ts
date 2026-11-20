// #3872 review: the finished-day scorer writes through the repository it is given, never one it
// looks up itself, and marks the day as filled on arrival so a later document may replace it.
import { describe, it, expect, vi } from 'vitest'
import type { WorkoutRepository } from '@/lib/data/repository'

vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => { throw new Error('looked up its own repository') }) }))
vi.mock('@trainingai/shared/health/score-audit/build-day-audit', () => ({
  buildDayAudit: vi.fn(async ({ date }: { date: string }) => ({
    pillars: date === '2026-11-17' ? [] : [{ pillar: 'readiness', persist: { score: 64, contributors: null, readinessSource: 'generic-derived' } }],
  })),
}))

describe('scoreFinishedDayReadiness (#3872 review)', () => {
  it('stores through the given repository with the filled-on-arrival mark', async () => {
    const { scoreFinishedDayReadiness, readinessFilledOnArrival } = await import('@/lib/health/night-readiness')
    const { READINESS_MODEL_VERSION } = await import('@trainingai/shared/health/readiness-composite')
    const upsertOuraDailyDerived = vi.fn(async () => {})
    const repo = { upsertOuraDailyDerived } as unknown as WorkoutRepository
    const now = new Date('2026-11-19T10:00:00Z')

    expect(await scoreFinishedDayReadiness(repo, 'u1', '2026-11-18', 'Australia/Brisbane', now)).toBe(true)
    expect(upsertOuraDailyDerived).toHaveBeenCalledWith('u1', '2026-11-18', expect.objectContaining({
      readinessScore: 64,
      modelVersions: { readiness: READINESS_MODEL_VERSION, readinessFilledOnArrival: '2026-11-19T10:00:00.000Z' },
    }))
    expect(readinessFilledOnArrival({ readiness: 'v', readinessFilledOnArrival: 'x' })).toBe(true)
    expect(readinessFilledOnArrival({ readiness: 'v' })).toBe(false)
    expect(readinessFilledOnArrival(null)).toBe(false)

    // No scoreable night: nothing written.
    expect(await scoreFinishedDayReadiness(repo, 'u1', '2026-11-17', 'Australia/Brisbane', now)).toBe(false)
    expect(upsertOuraDailyDerived).toHaveBeenCalledTimes(1)
  })
})
