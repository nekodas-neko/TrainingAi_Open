import { describe, it, expect } from 'vitest'
import { normalizeMuscle, moodMuscleMatches } from '../muscles'

describe('normalizeMuscle', () => {
  it('lowercases, trims and folds synonyms to one canonical name', () => {
    expect(normalizeMuscle(' Pecs ')).toBe('chest')
    expect(normalizeMuscle('Deltoids')).toBe('shoulders')
    expect(normalizeMuscle('Quadriceps')).toBe('quads')
    expect(normalizeMuscle('gluteal')).toBe('glutes')
    expect(normalizeMuscle('Hamstring')).toBe('hamstrings')
    expect(normalizeMuscle('trapezius')).toBe('traps')
    expect(normalizeMuscle('forearm')).toBe('forearms')
    expect(normalizeMuscle('external oblique')).toBe('obliques')
  })
  it('keeps distinct regions distinct and passes unknowns through lowercased', () => {
    expect(normalizeMuscle('Lats')).toBe('lats')
    expect(normalizeMuscle('Lower Back')).toBe('lower back')
    expect(normalizeMuscle('Tibialis Anterior')).toBe('tibialis anterior')
  })
})

describe('moodMuscleMatches (broad mood-picker labels)', () => {
  it('"Back" covers all back regions; "Shoulders" covers delts', () => {
    expect(moodMuscleMatches('lats', 'Back')).toBe(true)
    expect(moodMuscleMatches('upper back', 'Back')).toBe(true)
    expect(moodMuscleMatches('rear deltoids', 'Shoulders')).toBe(true)
    expect(moodMuscleMatches('chest', 'Back')).toBe(false)
    expect(moodMuscleMatches('biceps', 'Back')).toBe(false)
  })
  it('exact canonical matches work for everything else', () => {
    expect(moodMuscleMatches('Pecs', 'chest')).toBe(true)
  })
})
