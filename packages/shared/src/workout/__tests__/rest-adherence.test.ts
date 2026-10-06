import { describe, it, expect } from 'vitest'
import { restAdherencePct, restAdherenceSets } from '@trainingai/shared/workout/rest-adherence'
import type { SetLog } from '@trainingai/shared/types/log'

function set(setNumber: number, restTimeSec: number | undefined, plannedRestSec?: number): SetLog {
  return { id: `s${setNumber}`, exerciseLogId: 'ex-1', setNumber, weightKg: 100, reps: 5, useFor1rm: true, restTimeSec, plannedRestSec }
}

// #2181: a past set is graded against the plan of its own day. Today's style is only a fallback.
describe('restAdherenceSets', () => {
  const liveStyle = new Map([['style-1:1', 180], ['style-1:2', 180]])

  it('prefers the logged snapshot over the live style', () => {
    expect(restAdherenceSets([{ styleId: 'style-1', sets: [set(1, 90, 90)] }], liveStyle))
      .toEqual([{ actualRestSec: 90, prescribedRestSec: 90 }])
  })

  it('falls back to the live style only for a set with no snapshot', () => {
    expect(restAdherenceSets([{ styleId: 'style-1', sets: [set(1, 90, 90), set(2, 90)] }], liveStyle))
      .toEqual([
        { actualRestSec: 90, prescribedRestSec: 90 },
        { actualRestSec: 90, prescribedRestSec: 180 },
      ])
  })

  // "No rest planned" is what the plan asked that day. Replacing it with today's style would grade
  // the set against a target it never had.
  it('keeps a logged zero rather than falling back, so the set is left out of the mean', () => {
    const sets = restAdherenceSets([{ styleId: 'style-1', sets: [set(1, 60, 0), set(2, 90, 90)] }], liveStyle)
    expect(sets[0]).toEqual({ actualRestSec: 60, prescribedRestSec: 0 })
    expect(restAdherencePct(sets)).toBe(100)
  })

  it('has no prescription for a set with neither a snapshot nor a style', () => {
    expect(restAdherenceSets([{ styleId: undefined, sets: [set(1, 90)] }], liveStyle))
      .toEqual([{ actualRestSec: 90, prescribedRestSec: null }])
  })

  it('moves the session mean when the style was edited after the session', () => {
    // Logged at 90 s, rested 90 s: on plan. Against today's 180 s it would read as 50%.
    expect(restAdherencePct(restAdherenceSets([{ styleId: 'style-1', sets: [set(1, 90, 90), set(2, 90, 90)] }], liveStyle)))
      .toBe(100)
  })
})

describe('restAdherencePct', () => {
  it('averages actual/prescribed over sets with both values', () => {
    // 90/90 = 1.0, 45/90 = 0.5 → mean 0.75 → 75%
    expect(restAdherencePct([
      { actualRestSec: 90, prescribedRestSec: 90 },
      { actualRestSec: 45, prescribedRestSec: 90 },
      { actualRestSec: null, prescribedRestSec: 90 },   // skipped
      { actualRestSec: 120, prescribedRestSec: null },  // skipped
    ])).toBe(75)
  })
  it('returns null when no set has both values', () => {
    expect(restAdherencePct([{ actualRestSec: null, prescribedRestSec: 90 }])).toBeNull()
    expect(restAdherencePct([])).toBeNull()
  })
  it('caps a single wildly long rest so one forgotten timer cannot dominate', () => {
    // 900/90 capped at 3.0 → (3.0 + 1.0) / 2 = 2.0 → 200%
    expect(restAdherencePct([
      { actualRestSec: 900, prescribedRestSec: 90 },
      { actualRestSec: 90, prescribedRestSec: 90 },
    ])).toBe(200)
  })
})
