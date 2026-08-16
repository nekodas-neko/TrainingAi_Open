// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/sqlite/cache', () => ({
  invalidateCache: () => Promise.resolve(),
}))

import { invalidateWorkoutSummaries, invalidateProgramStructure } from '../cache-groups'

beforeEach(() => {
  sessionStorage.setItem('ta_recommendation_v1', 'stale')
  sessionStorage.setItem('ta_meta_v1', 'stale')
})

describe('legacy home seed clearing', () => {
  it('invalidateWorkoutSummaries clears both legacy sessionStorage seeds', async () => {
    await invalidateWorkoutSummaries()
    expect(sessionStorage.getItem('ta_recommendation_v1')).toBeNull()
    expect(sessionStorage.getItem('ta_meta_v1')).toBeNull()
  })

  it('invalidateProgramStructure also clears both legacy sessionStorage seeds', async () => {
    await invalidateProgramStructure()
    expect(sessionStorage.getItem('ta_recommendation_v1')).toBeNull()
    expect(sessionStorage.getItem('ta_meta_v1')).toBeNull()
  })
})
