import { describe, it, expect } from 'vitest'
import { floorSeedTtl, OFFLINE_SEED_TTL_FLOOR, TTL_SHORT } from '../cache-ttl'

describe('floorSeedTtl', () => {
  it('floors a short TTL up to the offline seed floor', () => {
    expect(floorSeedTtl(TTL_SHORT)).toBe(OFFLINE_SEED_TTL_FLOOR)
  })
  it('leaves a TTL longer than the floor untouched', () => {
    const longer = OFFLINE_SEED_TTL_FLOOR + 1000
    expect(floorSeedTtl(longer)).toBe(longer)
  })
  it('the floor is 7 days in seconds', () => {
    expect(OFFLINE_SEED_TTL_FLOOR).toBe(7 * 24 * 60 * 60)
  })
})
