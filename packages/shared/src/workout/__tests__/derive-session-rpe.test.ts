import { describe, it, expect } from 'vitest'
import { deriveSessionRpe, sessionEffort } from '../derive-session-rpe'

// Q-420. What these are actually about is the precedence rule: a self-reported rating must never be
// replaced by a derived one, and a derived one must never be presented as self-reported. Everything
// else is arithmetic.
describe('deriveSessionRpe', () => {
  it('is the plain mean of the rated sets, rounded to nearest', () => {
    expect(deriveSessionRpe([7, 8, 8])).toBe(8)      // 7.67
    expect(deriveSessionRpe([7, 7, 8])).toBe(7)      // 7.33
    expect(deriveSessionRpe([6, 10])).toBe(8)        // 8.0
  })

  it('ignores unrated sets rather than counting them as zero', () => {
    // The half of the sets that carry no rating is the majority in production (625 of 1,047), so
    // treating a null as a 0 would drag every session toward the floor.
    expect(deriveSessionRpe([8, null, undefined, 8])).toBe(8)
    expect(deriveSessionRpe([null, null])).toBeNull()
    expect(deriveSessionRpe([])).toBeNull()
  })

  it('rejects non-finite values', () => {
    expect(deriveSessionRpe([NaN, Infinity])).toBeNull()
    expect(deriveSessionRpe([8, NaN])).toBe(8)
  })

  // The observed set-RPE range is 6–10 and the strip floors at 6, so a derived value cannot reach
  // Foster's 'easy' tier. That is the correct outcome, not a rounding artefact to engineer around.
  it('stays in set-RPE units — it does not map onto the 1-10 session scale', () => {
    expect(deriveSessionRpe([6, 6, 6])).toBe(6)
    expect(deriveSessionRpe([10, 10])).toBe(10)
  })
})

describe('sessionEffort', () => {
  it('prefers a self-reported rating over the sets, always', () => {
    expect(sessionEffort(9, [6, 6, 6])).toEqual({ rpe: 9, source: 'self' })
  })

  it('derives when there is no self-reported rating', () => {
    expect(sessionEffort(null, [7, 8, 8])).toEqual({ rpe: 8, source: 'derived' })
    expect(sessionEffort(undefined, [7, 8, 8])).toEqual({ rpe: 8, source: 'derived' })
  })

  // The whole of the owner's "can be overwritten if needed": a later set edit re-derives, and a
  // self-reported value is untouched by it. Nothing is stored, so there is no re-derive rule to get
  // wrong and no way for a re-derive to eat a manual correction.
  it('a later set edit changes a derived value and never a self-reported one', () => {
    expect(sessionEffort(null, [7, 7])).toEqual({ rpe: 7, source: 'derived' })
    expect(sessionEffort(null, [7, 7, 10, 10])).toEqual({ rpe: 9, source: 'derived' })
    expect(sessionEffort(8, [7, 7, 10, 10])).toEqual({ rpe: 8, source: 'self' })
  })

  it('is null when the session carries neither', () => {
    expect(sessionEffort(null, [])).toBeNull()
    expect(sessionEffort(null, [null, null])).toBeNull()
  })

  // A 0 is a real self-report on the 1-10 grid's lower reaches, and `?? ` / falsy checks would drop
  // it. Pinned because the natural implementation gets this wrong.
  it('treats a self-reported 0 as a rating, not as absent', () => {
    expect(sessionEffort(0, [8, 8])).toEqual({ rpe: 0, source: 'self' })
  })
})
