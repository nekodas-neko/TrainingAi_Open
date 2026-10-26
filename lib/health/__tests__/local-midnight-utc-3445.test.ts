// #3445: local midnight probed at noon UTC, which is already the next day in UTC+12..+14 zones.
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/data/repository', () => ({}))
import { localMidnightUtc } from '../energy-balance-service'

describe('localMidnightUtc (#3445)', () => {
  it('is the start of the named day in Pacific/Auckland (UTC+13 in summer)', () => {
    expect(localMidnightUtc('2026-12-15', 'Pacific/Auckland').toISOString()).toBe('2026-12-14T11:00:00.000Z')
  })

  it('is the start of the named day in Pacific/Kiritimati (UTC+14)', () => {
    expect(localMidnightUtc('2026-12-15', 'Pacific/Kiritimati').toISOString()).toBe('2026-12-14T10:00:00.000Z')
  })

  it('bounds the 23 h spring-forward day in Sydney', () => {
    const ms = localMidnightUtc('2026-10-05', 'Australia/Sydney').getTime() - localMidnightUtc('2026-10-04', 'Australia/Sydney').getTime()
    expect(ms).toBe(23 * 3_600_000)
  })
})
