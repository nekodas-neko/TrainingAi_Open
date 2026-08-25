// The weekly-volume card coloured every muscle against a hardcoded generic 10–20 band while
// `MUSCLE_LANDMARKS` sat in packages/shared carrying MEV/MAV/MRV per muscle (Q-305).
//
// The goal multiplier is what makes the difference material, and Q-305's own first pass is the
// proof: it compared against the raw hypertrophy row and concluded lats and upper back were below
// MEV. Against the table the app actually uses — powerbuilding, ×0.8 — both are in range, and three
// other muscles are over MRV. Reading the wrong row inverted the finding.
import { describe, it, expect } from 'vitest'
import { volumeVerdict } from '../volume-band'

const GOAL = 'powerbuilding'

describe('volume band', () => {
  // The 56-day measurement recorded on the entry, against the scaled table.
  it.each([
    ['glutes', 22.1, 'over'],
    ['hamstrings', 21.6, 'over'],
    ['triceps', 20.3, 'over'],
    ['shoulders', 14.9, 'high'],
    ['biceps', 14.0, 'high'],
    ['lats', 9.3, 'in'],
    ['upper back', 6.3, 'in'],
    ['calves', 2.8, 'under'],
  ])('reads %s at %s sets as %s', (muscle, sets, band) => {
    expect(volumeVerdict(GOAL, muscle as string, sets as number).band).toBe(band)
  })

  // The correction the entry had to make to itself: the unscaled row says "under" where the app's
  // own table says "in range".
  it('is the goal multiplier that moves lats out of a deficit', () => {
    expect(volumeVerdict('hypertrophy', 'lats', 9.3).band).toBe('under')
    expect(volumeVerdict('powerbuilding', 'lats', 9.3).band).toBe('in')
  })

  // Two of the four bands are red and they need opposite responses, so the word is not decoration.
  it('gives the two red bands different words', () => {
    const under = volumeVerdict(GOAL, 'calves', 0)
    const over = volumeVerdict(GOAL, 'calves', 999)
    expect(under.color).toBe(over.color)
    expect(under.label).not.toBe(over.label)
    expect([under.label, over.label]).toEqual(['below MEV', 'above MRV'])
  })

  it('puts each landmark on the boundary it names', () => {
    const { mev, mav, mrv } = volumeVerdict(GOAL, 'biceps', 0)
    expect(volumeVerdict(GOAL, 'biceps', mev - 1).band).toBe('under')
    expect(volumeVerdict(GOAL, 'biceps', mev).band).toBe('in')
    expect(volumeVerdict(GOAL, 'biceps', mav).band).toBe('in')
    expect(volumeVerdict(GOAL, 'biceps', mav + 1).band).toBe('high')
    expect(volumeVerdict(GOAL, 'biceps', mrv).band).toBe('high')
    expect(volumeVerdict(GOAL, 'biceps', mrv + 1).band).toBe('over')
  })

  // `core` is tagged on exercises and absent from MUSCLE_LANDMARKS; `normalizeMuscle` maps it to
  // `abs` before the lookup. Recorded on the entry as checked-and-clean — pinned so it stays that way.
  it('resolves an aliased muscle rather than falling through to the default', () => {
    expect(volumeVerdict(GOAL, 'core', 5)).toEqual(volumeVerdict(GOAL, 'abs', 5))
  })

  it('falls back to a default table for a muscle it has never heard of', () => {
    const v = volumeVerdict(GOAL, 'not-a-muscle', 5)
    expect(v.mev).toBeGreaterThan(0)
    expect(v.mrv).toBeGreaterThan(v.mav)
  })
})
