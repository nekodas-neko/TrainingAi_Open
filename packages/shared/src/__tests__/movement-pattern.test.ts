import { describe, it, expect } from 'vitest'
import { movementPattern, CLASSIFIED_MUSCLES, normalizeMuscle } from '../muscles'

/**
 * LB-103 — the push/pull/legs grouping Q-305's balance figure is blocked on.
 *
 * Q-305 rejected computing this inside `weekly-muscle-sets-card.tsx` because a private second copy of
 * the grouping is the divergence One Formula One Place exists to stop. This is the entry that call
 * implies, and these are the tests that make `other` a real bucket rather than a silent fallback.
 */
describe('movementPattern', () => {
  it.each([
    ['chest', 'push'], ['shoulders', 'push'], ['triceps', 'push'],
    ['lats', 'pull'], ['upper back', 'pull'], ['biceps', 'pull'], ['traps', 'pull'], ['forearms', 'pull'],
    ['quads', 'legs'], ['hamstrings', 'legs'], ['glutes', 'legs'], ['calves', 'legs'],
    ['abs', 'other'], ['obliques', 'other'], ['lower back', 'other'],
  ])('puts %s in %s', (muscle, pattern) => {
    expect(movementPattern(muscle)).toBe(pattern)
  })

  it('folds synonyms first, so the catalogue-s own names resolve', () => {
    // `core` is what the exercise catalogue actually stores; `normalizeMuscle` folds it to `abs`.
    expect(normalizeMuscle('core')).toBe('abs')
    expect(movementPattern('core')).toBe('other')
    expect(movementPattern('Pecs')).toBe('push')
    expect(movementPattern('DELTS')).toBe('push')
    expect(movementPattern('  quadriceps  ')).toBe('legs')
  })

  /**
   * The two judgement calls, pinned so a later change to either is deliberate rather than incidental.
   * Both are argued in the module's own comment; what the test adds is that changing one breaks here
   * and has to be justified, instead of quietly moving a percentage on a card.
   */
  it('counts shoulders as push, which is a call and not a fact', () => {
    expect(movementPattern('shoulders')).toBe('push')
  })

  it('counts lower back as neither, because everything trains it', () => {
    expect(movementPattern('lower back')).toBe('other')
    expect(movementPattern('lower back')).not.toBe('pull')
    expect(movementPattern('lower back')).not.toBe('legs')
  })
})

/**
 * Coverage, which is the half that makes this safe to build on.
 *
 * `other` is a legitimate destination for abs, obliques and the lower back — so an unmapped muscle
 * landing there is indistinguishable from a classified one by looking at the output. These assert the
 * vocabulary instead: every name the landmark table uses, and every name the real catalogue stores.
 */
describe('every muscle the app actually uses is classified', () => {
  // The 19 keys of MUSCLE_LANDMARKS (`volume-targets.ts`), which is the app's own muscle table.
  const LANDMARK_MUSCLES = [
    'chest', 'back', 'lats', 'upper back', 'lower back', 'quads', 'hamstrings', 'glutes', 'shoulders',
    'biceps', 'triceps', 'calves', 'traps', 'forearms', 'abs', 'obliques', 'hip flexors',
    'adductors', 'abductors',
  ]

  // Measured against the seeded catalogue, 2026-09-13: 146 exercises, 18 distinct muscle names.
  // `core` is stored and folds to `abs`; there is no bare `back` in the catalogue, only in the table.
  const CATALOGUE_MUSCLES = [
    'abductors', 'adductors', 'biceps', 'calves', 'chest', 'core', 'forearms', 'glutes', 'hamstrings',
    'hip flexors', 'lats', 'lower back', 'obliques', 'quads', 'shoulders', 'traps', 'triceps',
    'upper back',
  ]

  it.each(LANDMARK_MUSCLES)('classifies the landmark muscle %s', (m) => {
    expect(CLASSIFIED_MUSCLES).toContain(normalizeMuscle(m))
  })

  it.each(CATALOGUE_MUSCLES)('classifies the catalogue muscle %s', (m) => {
    expect(CLASSIFIED_MUSCLES).toContain(normalizeMuscle(m))
  })

  it('classifies nothing it does not know, rather than guessing', () => {
    expect(movementPattern('neck')).toBe('other')
    expect(CLASSIFIED_MUSCLES).not.toContain('neck')
  })

  it('spans all four patterns, so no bucket is dead', () => {
    const seen = new Set(CLASSIFIED_MUSCLES.map(m => movementPattern(m)))
    expect([...seen].sort()).toEqual(['legs', 'other', 'pull', 'push'])
  })
})
