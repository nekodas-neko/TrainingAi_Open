/**
 * #4158 — the running-plan payload carries the bpm where a heart-health minute starts to count
 * (`heartHealth.floorBpm`), so the Cardio Hub can say it once. It is the same floor the day
 * measurement uses (`heartHealthFloorBpm`); nothing about what counts changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getPrescribedRuns = vi.fn(async (..._a: unknown[]) => [] as Row[])
const resolveHrProfile = vi.fn(async (..._a: unknown[]) => ({ maxHr: 190, restingHr: 50 }) as Row)

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-floor', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getActiveRunningPlan: async () => ({ id: 'p1', userId: 'u-floor', goalKind: 'heart_health', frameworkKey: 'zone2', isActive: true }),
    getPrescribedRuns: (...a: unknown[]) => getPrescribedRuns(...a),
    upsertPrescribedRun: async (_u: string, r: Row) => r,
    listActivityLogs: async () => [],
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/health/hr-profile', async (orig) => ({
  ...(await orig() as object),
  resolveHrProfile: (...a: unknown[]) => resolveHrProfile(...a),
}))
vi.mock('@trainingai/shared/running/prescription', async (orig) => ({
  ...(await orig() as object),
  prescribeNextRun: () => ({
    prescription: {
      type: 'easy', durationMin: 40, distanceKm: 6,
      targets: { zoneIds: [2], hrLowBpm: 120, hrHighBpm: 140 }, rationale: 'x', frameworkKey: 'zone2',
    },
    gateAction: 'proceed', gateReasons: [],
  }),
}))
vi.mock('@trainingai/shared/running/assemble-plan-context', () => ({
  assembleInputs: async () => ({ ctx: {}, gate: {} }),
  resolveSnapshot: async () => ({ restingHr: 50, maxHr: 190, weeklyBaseMinutes: 150 }),
  resolvePushContext: async () => ({ isPush: false, bestDistanceKm: null }),
}))

import { GET } from '@/app/api/running-plan/route'

beforeEach(() => {
  vi.clearAllMocks()
  resolveHrProfile.mockResolvedValue({ maxHr: 190, restingHr: 50 })
})

describe('GET /api/running-plan heartHealth.floorBpm (#4158)', () => {
  it('sends the moderate-effort floor for the profile: 40% of the reserve above resting', async () => {
    const body = await (await GET()).json()
    // 50 + 0.4 × (190 − 50) = 106
    expect(body.heartHealth.floorBpm).toBe(106)
    expect(body.heartHealth.days).toEqual([])
  })

  it('sends null, and still the days, when the profile cannot be read', async () => {
    resolveHrProfile.mockRejectedValue(new Error('db down'))
    const body = await (await GET()).json()
    expect(body.heartHealth.floorBpm).toBeNull()
    expect(Array.isArray(body.heartHealth.days)).toBe(true)
  })
})
