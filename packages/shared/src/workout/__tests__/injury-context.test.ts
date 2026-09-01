// BF-68 — the builder path contained the string `injur` zero times, so a sore lower back could not
// reach it and the constraint died at save even when the chat appeared to honour it. These pin the
// one description of "what is currently injured", which BF-44 imports for the Coach surface rather
// than writing a second one.
import { describe, it, expect } from 'vitest'
import { activeInjuries, activeInjuredMuscles, formatInjuryContext } from '../injury-context'
import { excludeInjuredExercises, injurySafeAlternatives } from '../injury-substitution'
import type { Injury } from '../../types/injury'

const base: Omit<Injury, 'id' | 'muscleName' | 'severity' | 'startedDate' | 'resolvedDate' | 'notes'> = {
  userId: 'u', createdAt: '', updatedAt: '',
}
const injury = (over: Partial<Injury> & Pick<Injury, 'muscleName' | 'startedDate'>): Injury => ({
  ...base, id: over.muscleName, severity: 'moderate', resolvedDate: null, notes: null, ...over,
})

const TODAY = '2026-09-01'

describe('activeInjuries', () => {
  it('drops resolved ones — `resolvedDate` is the only "is it over" signal', () => {
    const rows = [
      injury({ muscleName: 'Lower Back', startedDate: '2026-08-20' }),
      injury({ muscleName: 'Shoulders', startedDate: '2026-01-01', resolvedDate: '2026-02-01' }),
    ]
    expect(activeInjuries(rows).map(i => i.muscleName)).toEqual(['Lower Back'])
  })

  // An injury from years ago with no resolved date is still active. It looks like staleness and is
  // not: nothing expires an injury, so inventing an expiry here would silently lift a constraint.
  it('does not expire an old unresolved injury', () => {
    const rows = [injury({ muscleName: 'Knees', startedDate: '2024-03-02' })]
    expect(activeInjuries(rows)).toHaveLength(1)
  })

  it('lowercases and de-duplicates the muscle names it hands the filter', () => {
    const rows = [
      injury({ muscleName: 'Lower Back', startedDate: '2026-08-20' }),
      injury({ muscleName: 'lower back', startedDate: '2026-08-25' }),
    ]
    expect(activeInjuredMuscles(rows)).toEqual(['lower back'])
  })
})

describe('formatInjuryContext', () => {
  it('is empty when nothing is active, so a caller can append it unconditionally', () => {
    expect(formatInjuryContext([], TODAY)).toBe('')
    expect(formatInjuryContext([injury({ muscleName: 'X', startedDate: '2026-01-01', resolvedDate: '2026-02-01' })], TODAY)).toBe('')
  })

  it('carries muscle, severity, duration and the user\'s own note', () => {
    const rows = [injury({ muscleName: 'Lower Back', severity: 'severe', startedDate: '2026-08-20', notes: 'sore when hinging' })]
    expect(formatInjuryContext(rows, TODAY)).toBe('- Lower Back (severe, active 12 days) — "sore when hinging"')
  })

  it('reads "started today" rather than "active 0 days"', () => {
    expect(formatInjuryContext([injury({ muscleName: 'Calves', startedDate: TODAY })], TODAY))
      .toBe('- Calves (moderate, started today)')
  })

  it('singularises one day', () => {
    expect(formatInjuryContext([injury({ muscleName: 'Calves', startedDate: '2026-08-31' })], TODAY))
      .toContain('active 1 day)')
  })
})

describe('excludeInjuredExercises', () => {
  const library = [
    { name: 'Deadlift', muscles: [{ muscle: 'Lower Back', role: 'main' }, { muscle: 'Hamstrings', role: 'secondary' }], equipment: ['barbell'] },
    { name: 'Good Morning', muscles: [{ muscle: 'Hamstrings', role: 'main' }, { muscle: 'Lower Back', role: 'secondary' }], equipment: ['barbell'] },
    { name: 'Leg Curl', muscles: [{ muscle: 'Hamstrings', role: 'main' }], equipment: ['machine'] },
  ]

  // The secondary role is the one a prompt instruction misses: a Good Morning is a hamstring
  // exercise by name and still loads the injured back.
  it('drops an exercise that touches the injured muscle in ANY role', () => {
    expect(excludeInjuredExercises(library, ['Lower Back']).map(e => e.name)).toEqual(['Leg Curl'])
  })

  it('is a no-op with no injuries, and case-insensitive with them', () => {
    expect(excludeInjuredExercises(library, [])).toHaveLength(3)
    expect(excludeInjuredExercises(library, ['lower back'])).toHaveLength(1)
  })

  // The extraction must not have changed what the swap sheet offers — that is the surface this
  // predicate came out of, and the builder using a different one is the drift being prevented.
  it('still governs injurySafeAlternatives', () => {
    const out = injurySafeAlternatives({ name: 'Deadlift', mainMuscles: ['Hamstrings', 'Lower Back'] }, ['Lower Back'], library)
    expect(out.map(e => e.name)).toEqual(['Leg Curl'])
  })
})
