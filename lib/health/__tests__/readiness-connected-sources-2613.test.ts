// Issue 2613 — the readiness payload names which device sources are connected. Driven through the
// real `buildReadinessPayload` with a mocked repository, as the other readiness payload tests are.
// The DB-backed half (what each source means, user scoping) is
// lib/data/postgres/__tests__/recent-source-facts-2613.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  getMoodLog: vi.fn(async (_u: string, _d: string) => null),
  getUserById: vi.fn(async (_u: string) => ({ timezone: 'Australia/Brisbane', dateOfBirth: '1990-01-01', sex: 'male', heightCm: 180 })),
  getUserGoals: vi.fn(async (_u: string) => ({ stepsGoal: null })),
  upsertOuraDailyDerived: vi.fn(async () => undefined),
  upsertOuraDailySummary: vi.fn(async () => undefined),
  hasOuraBleSamples: vi.fn(async (_u: string) => false),
  getRecentSourceFacts: vi.fn(async (_u: string, _s: Date) => ({ strapHeartRate: false, healthConnectHeartRate: false, healthConnectIntervals: false })),
  getOuraCloudTokens: vi.fn(async (_u: string) => null as { accessToken: string | null } | null),
}

vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))

import { buildReadinessPayload } from '@/lib/health/readiness-payload'

const TZ = 'Australia/Brisbane'

beforeEach(() => {
  repo.hasOuraBleSamples.mockReset()
  repo.getRecentSourceFacts.mockReset()
  repo.hasOuraBleSamples.mockResolvedValue(false)
  repo.getRecentSourceFacts.mockResolvedValue({ strapHeartRate: false, healthConnectHeartRate: false, healthConnectIntervals: false })
  repo.getOuraCloudTokens.mockReset()
  repo.getOuraCloudTokens.mockResolvedValue(null)
})

describe('readiness payload connectedSources (issue 2613)', () => {
  it('names a ring-only user', async () => {
    repo.hasOuraBleSamples.mockResolvedValue(true)
    expect((await buildReadinessPayload('u1', TZ)).connectedSources).toEqual({ ring: true, strap: false, healthConnect: false, ouraCloud: false })
  })

  it('names a strap-only user', async () => {
    repo.getRecentSourceFacts.mockResolvedValue({ strapHeartRate: true, healthConnectHeartRate: false, healthConnectIntervals: false })
    expect((await buildReadinessPayload('u1', TZ)).connectedSources).toEqual({ ring: false, strap: true, healthConnect: false, ouraCloud: false })
  })

  it('names a Health Connect-only user', async () => {
    repo.getRecentSourceFacts.mockResolvedValue({ strapHeartRate: false, healthConnectHeartRate: false, healthConnectIntervals: true })
    expect((await buildReadinessPayload('u1', TZ)).connectedSources).toEqual({ ring: false, strap: false, healthConnect: true, ouraCloud: false })
  })

  it('reports all false for a user with none: a known answer, not unknown', async () => {
    expect((await buildReadinessPayload('u1', TZ)).connectedSources).toEqual({ ring: false, strap: false, healthConnect: false, ouraCloud: false })
  })

  it('names an Oura Cloud connection, and not a token row without an access token (#3115)', async () => {
    repo.getOuraCloudTokens.mockResolvedValue({ accessToken: 'sealed' })
    expect((await buildReadinessPayload('u1', TZ)).connectedSources?.ouraCloud).toBe(true)
    repo.getOuraCloudTokens.mockResolvedValue({ accessToken: null })
    expect((await buildReadinessPayload('u1', TZ)).connectedSources?.ouraCloud).toBe(false)
  })

  it('omits the field when the Oura Cloud lookup fails, so the phones filter nothing', async () => {
    repo.getOuraCloudTokens.mockRejectedValueOnce(new Error('db down'))
    expect('connectedSources' in (await buildReadinessPayload('u1', TZ))).toBe(false)
  })

  it('scopes both lookups to the requesting user', async () => {
    await buildReadinessPayload('user-xyz', TZ)
    expect(repo.hasOuraBleSamples).toHaveBeenCalledWith('user-xyz')
    expect(repo.getRecentSourceFacts.mock.calls[0][0]).toBe('user-xyz')
    expect(repo.getOuraCloudTokens).toHaveBeenCalledWith('user-xyz')
  })

  it('omits the field (unknown, not false) when the lookup fails, leaving every other field intact', async () => {
    const baseline = await buildReadinessPayload('u1', TZ)
    repo.getRecentSourceFacts.mockRejectedValueOnce(new Error('db down'))
    const out = await buildReadinessPayload('u1', TZ)
    expect('connectedSources' in out).toBe(false)
    const { connectedSources: _c, ...rest } = baseline
    expect(out).toEqual(rest)
  })

  it('a payload cached before the field existed reads as unknown', () => {
    const cached = JSON.parse('{"score":null}') as { connectedSources?: unknown }
    expect(cached.connectedSources).toBeUndefined()
  })
})
