import { describe, it, expect } from 'vitest'
import { shouldPrune } from '../retention-throttle'

describe('shouldPrune', () => {
  it('is false when the window has not yet elapsed', () => {
    expect(shouldPrune(1000, 1000 + 60_000, 24 * 60 * 60 * 1000)).toBe(false)
  })

  it('is true once the window has elapsed', () => {
    const windowMs = 24 * 60 * 60 * 1000
    expect(shouldPrune(0, windowMs + 1, windowMs)).toBe(true)
  })

  it('is true exactly at the boundary', () => {
    const windowMs = 24 * 60 * 60 * 1000
    expect(shouldPrune(0, windowMs, windowMs)).toBe(true)
  })

  it('is true on the very first call (lastPruneMs = 0, well in the past)', () => {
    expect(shouldPrune(0, Date.now(), 24 * 60 * 60 * 1000)).toBe(true)
  })
})
