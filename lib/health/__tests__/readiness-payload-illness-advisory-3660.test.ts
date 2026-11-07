// #3660 — the payload's illness advisory names what moved. `illnessAdvisory(flag, biomarkers)` has
// named the drifting biomarkers since TN-45, but the payload called it with the flag alone, so the
// watch line on Home and both readiness screens always read "Some biomarkers…". The radar result is
// stubbed to a watch day so the test reads the field the screens render. Synthetic values only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { monthFixture, fixtureRepo } from './fixtures/activity-day-fixtures'

let repo: Record<string, unknown>
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
vi.mock('@trainingai/shared/health/illness-radar', async (orig) => {
  const real = await orig<typeof import('@trainingai/shared/health/illness-radar')>()
  return {
    ...real,
    computeIllnessRadar: () => ({
      flag: 'watch' as const,
      score: 40,
      readinessSuppression: 0,
      biomarkers: {
        restingHeartRate: { z: 1.5, contribution: 20 },
        hrvBalance: { z: -1.2, contribution: 15 },
        temperature: { z: 0.1, contribution: 0 },
      },
    }),
  }
})

import { buildReadinessPayload } from '@/lib/health/readiness-payload'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-24'

describe('the readiness payload names the biomarkers behind a watch day (#3660)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${TODAY}T05:00:00Z`))
  })
  afterEach(() => vi.useRealTimers())

  it('the advisory the screens render names resting HR and HRV, not "Some biomarkers"', async () => {
    repo = { ...fixtureRepo(monthFixture(TODAY, TZ)) }
    const payload = await buildReadinessPayload('u1', TZ)
    expect(payload.illnessFlag).toBe('watch')
    expect(payload.illnessAdvisory).toMatch(/^Resting HR and HRV are drifting from your baseline/)
    expect(payload.illnessAdvisory).not.toMatch(/Some biomarkers/)
  })
})
