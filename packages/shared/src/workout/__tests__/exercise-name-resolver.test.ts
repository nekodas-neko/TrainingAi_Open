import { describe, it, expect } from 'vitest'
import {
  buildExerciseNameResolver,
  resolveAgainstLibrary,
} from '../exercise-name-resolver'
import type { MuscleAssignment } from '../../types/program'

function lib(name: string, muscles: MuscleAssignment[] = []) {
  return { name, muscles }
}

const LIBRARY = [
  lib('Bench Press', [
    { muscle: 'Chest', role: 'main' },
    { muscle: 'Triceps', role: 'secondary' },
  ]),
  lib('Incline Bench Press', [{ muscle: 'Chest', role: 'main' }]),
  lib('Romanian Deadlift', [{ muscle: 'Hamstrings', role: 'main' }]),
  lib('Lateral Raise', [{ muscle: 'Shoulders', role: 'main' }]),
  lib('Seated Cable Row', [{ muscle: 'Back', role: 'main' }]),
]

describe('buildExerciseNameResolver', () => {
  it('matches an exact library name', () => {
    const r = buildExerciseNameResolver(LIBRARY)
    expect(r.resolve('Bench Press')?.name).toBe('Bench Press')
  })

  it('matches through case, punctuation and pluralisation', () => {
    const r = buildExerciseNameResolver(LIBRARY)
    expect(r.resolve('bench press')?.name).toBe('Bench Press')
    expect(r.resolve('Lateral Raises')?.name).toBe('Lateral Raise')
    expect(r.resolve('Seated Cable-Row')?.name).toBe('Seated Cable Row')
  })

  it('matches a plural the shared normaliser does not know', () => {
    const r = buildExerciseNameResolver([lib('Barbell Deadlift'), lib('Pull-Up'), lib('Plank')])
    expect(r.resolve('Barbell Deadlifts')?.name).toBe('Barbell Deadlift')
    expect(r.resolve('Pull-Ups')?.name).toBe('Pull-Up')
    expect(r.resolve('Planks')?.name).toBe('Plank')
  })

  it('expands the abbreviations the model actually writes', () => {
    const r = buildExerciseNameResolver(LIBRARY)
    expect(r.resolve('RDL')?.name).toBe('Romanian Deadlift')
  })

  it('matches regardless of word order', () => {
    const r = buildExerciseNameResolver(LIBRARY)
    expect(r.resolve('Press Bench')?.name).toBe('Bench Press')
    expect(r.resolve('Cable Row Seated')?.name).toBe('Seated Cable Row')
  })

  // The whole point of stopping at word order. A subset tier would answer 'Bench Press' here, and
  // the two lifts' 1RM histories would merge under one `(user_id, exercise_name)` key.
  it('does NOT reach a shorter library name by dropping a qualifier', () => {
    const r = buildExerciseNameResolver(LIBRARY)
    expect(r.resolve('Barbell Bench Press')).toBeNull()
  })

  it('keeps a qualified name distinct from the one it qualifies', () => {
    const r = buildExerciseNameResolver(LIBRARY)
    expect(r.resolve('incline bench press')?.name).toBe('Incline Bench Press')
    expect(r.resolve('bench press')?.name).toBe('Bench Press')
  })

  it('returns null for a name the library genuinely does not hold', () => {
    const r = buildExerciseNameResolver(LIBRARY)
    expect(r.resolve('Zercher Good Morning')).toBeNull()
  })

  // Two entries that collapse to one widened key would otherwise resolve to whichever was indexed
  // last, silently attaching one lift's muscles and history to the other.
  it('refuses an ambiguous normalised key rather than picking one', () => {
    const ambiguous = buildExerciseNameResolver([lib('Cable Row'), lib('Cable Rows')])
    expect(ambiguous.resolve('cable row')).toBeNull()
    // …but an exact hit is still unambiguous and still resolves.
    expect(ambiguous.resolve('Cable Row')?.name).toBe('Cable Row')
    expect(ambiguous.resolve('Cable Rows')?.name).toBe('Cable Rows')
  })

  it('refuses an ambiguous word-order key rather than picking one', () => {
    const ambiguous = buildExerciseNameResolver([
      lib('Seated Cable Row'),
      lib('Cable Seated Row'),
    ])
    expect(ambiguous.resolve('Row Seated Cable')).toBeNull()
    expect(ambiguous.resolve('Seated Cable Row')?.name).toBe('Seated Cable Row')
    // The narrower tier still discriminates what the wider one cannot: these two differ only in
    // word order, so a case-only variant of either is unambiguous and must still resolve.
    expect(ambiguous.resolve('seated cable row')?.name).toBe('Seated Cable Row')
    expect(ambiguous.resolve('cable seated row')?.name).toBe('Cable Seated Row')
  })

  it('handles an empty library without throwing', () => {
    expect(buildExerciseNameResolver([]).resolve('Bench Press')).toBeNull()
  })
})

describe('resolveAgainstLibrary', () => {
  const resolver = buildExerciseNameResolver(LIBRARY)

  it("rewrites a paraphrase to the library's spelling and keeps the exercise", () => {
    const { resolved, unresolved } = resolveAgainstLibrary(
      [{ name: 'lateral raises', exerciseRole: 'accessory' }],
      resolver,
    )
    expect(unresolved).toEqual([])
    expect(resolved).toHaveLength(1)
    expect(resolved[0].name).toBe('Lateral Raise')
    // Fields the caller supplied survive the rewrite.
    expect(resolved[0].exerciseRole).toBe('accessory')
  })

  it("overwrites the model's muscle guess with the library's assignments", () => {
    const { resolved } = resolveAgainstLibrary(
      [{ name: 'Bench Press', mainMuscles: ['Glutes'], secondaryMuscles: ['Calves'] }],
      resolver,
    )
    expect(resolved[0].mainMuscles).toEqual(['Chest'])
    expect(resolved[0].secondaryMuscles).toEqual(['Triceps'])
  })

  it('reports an unresolvable name instead of keeping it with guessed muscles', () => {
    const { resolved, unresolved } = resolveAgainstLibrary(
      [
        { name: 'Bench Press' },
        { name: 'Zercher Good Morning', mainMuscles: ['Hamstrings'] },
        { name: 'RDL' },
      ],
      resolver,
    )
    expect(unresolved).toEqual(['Zercher Good Morning'])
    expect(resolved.map(e => e.name)).toEqual(['Bench Press', 'Romanian Deadlift'])
  })

  it('gives an exercise with no library muscles empty arrays, never undefined', () => {
    const { resolved } = resolveAgainstLibrary(
      [{ name: 'Cable Row' }],
      buildExerciseNameResolver([lib('Cable Row')]),
    )
    expect(resolved[0].mainMuscles).toEqual([])
    expect(resolved[0].secondaryMuscles).toEqual([])
  })
})
