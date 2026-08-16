import { describe, it, expect } from 'vitest'
import { isPushSession, inferEnvironment } from '../push-sessions'

describe('isPushSession', () => {
  it('is false for the first 4 completed sessions in a plan', () => {
    expect(isPushSession(0)).toBe(false)
    expect(isPushSession(1)).toBe(false)
    expect(isPushSession(2)).toBe(false)
    expect(isPushSession(3)).toBe(false)
  })

  it('is true on the 5th completed session (0-indexed: 4)', () => {
    expect(isPushSession(4)).toBe(true)
  })

  it('repeats every 5 sessions', () => {
    expect(isPushSession(9)).toBe(true)
    expect(isPushSession(14)).toBe(true)
    expect(isPushSession(8)).toBe(false)
  })
})

describe('inferEnvironment', () => {
  it('is outdoor when a route polyline is present', () => {
    expect(inferEnvironment('abc123polyline')).toBe('outdoor')
  })

  it('is indoor when there is no route (treadmill, or GPS unavailable)', () => {
    expect(inferEnvironment(null)).toBe('indoor')
    expect(inferEnvironment('')).toBe('indoor')
  })
})
