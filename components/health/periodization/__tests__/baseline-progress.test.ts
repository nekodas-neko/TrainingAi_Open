import { describe, expect, it } from 'vitest'
import { baselineProgress, baselineProgressLabel } from '../baseline-progress'

const IDS = ['e1', 'e2', 'e3', 'e4', 'e5']

describe('baselineProgress — LA-92', () => {
  it('counts the session exercises that have an anchor', () => {
    expect(baselineProgress({ e1: {}, e3: {}, e4: {} }, IDS)).toEqual({ logged: 3, total: 5 })
  })

  it('reads zero as zero rather than as no answer', () => {
    // The whole defect was that nothing and almost-everything looked the same.
    expect(baselineProgress({}, IDS)).toEqual({ logged: 0, total: 5 })
    expect(baselineProgress(null, IDS)).toEqual({ logged: 0, total: 5 })
  })

  it('ignores an anchor for an exercise no longer in the session', () => {
    // Anchors are keyed by session-exercise id and survive a program edit, so a plain key count
    // can exceed the exercise list — "6 of 5" is reachable without this.
    expect(baselineProgress({ e1: {}, gone: {}, alsoGone: {} }, IDS)).toEqual({ logged: 1, total: 5 })
  })

  it('has no answer when the exercise list is unknown, rather than inventing a denominator', () => {
    expect(baselineProgress({ e1: {} }, null)).toBeNull()
    expect(baselineProgress({ e1: {} }, undefined)).toBeNull()
    expect(baselineProgress({}, [])).toBeNull()
  })
})

describe('baselineProgressLabel — LA-92', () => {
  it('says what is done out of what there is', () => {
    expect(baselineProgressLabel({ logged: 3, total: 5 })).toBe('3 of 5 exercises logged')
  })

  it('does not write "1 exercises"', () => {
    expect(baselineProgressLabel({ logged: 0, total: 1 })).toBe('0 of 1 exercise logged')
  })
})
