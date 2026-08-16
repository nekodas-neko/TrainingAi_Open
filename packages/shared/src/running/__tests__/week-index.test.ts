import { describe, it, expect } from 'vitest'
import { weekIndexSince } from '../week-index'

describe('weekIndexSince', () => {
  it('returns 0 for the plan-creation day itself', () => {
    const created = new Date('2026-07-01T00:00:00Z')
    const today = new Date('2026-07-01T00:00:00Z')
    expect(weekIndexSince(created, today)).toBe(0)
  })

  it('returns 0 for any day within the first 7 days', () => {
    const created = new Date('2026-07-01T00:00:00Z')
    const today = new Date('2026-07-06T00:00:00Z')
    expect(weekIndexSince(created, today)).toBe(0)
  })

  it('returns 1 once 7 days have elapsed', () => {
    const created = new Date('2026-07-01T00:00:00Z')
    const today = new Date('2026-07-08T00:00:00Z')
    expect(weekIndexSince(created, today)).toBe(1)
  })

  it('returns 3 after 3 full weeks plus a few days', () => {
    const created = new Date('2026-07-01T00:00:00Z')
    const today = new Date('2026-07-25T00:00:00Z') // 24 days later
    expect(weekIndexSince(created, today)).toBe(3)
  })

  it('clamps to 0 if today is somehow before plan creation', () => {
    const created = new Date('2026-07-10T00:00:00Z')
    const today = new Date('2026-07-01T00:00:00Z')
    expect(weekIndexSince(created, today)).toBe(0)
  })
})
