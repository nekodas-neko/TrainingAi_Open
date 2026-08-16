import { describe, it, expect } from 'vitest'
import {
  computePerExerciseDeload,
  type PerExerciseDeloadInput,
} from '@trainingai/shared/ai-periodization/per-exercise-deload'

const ex = (
  id: string,
  main: string[],
  secondary: string[] = [],
): PerExerciseDeloadInput => ({
  sessionExerciseId: id,
  name: id,
  muscleAssignments: [
    ...main.map(m => ({ muscle: m, role: 'main' as const })),
    ...secondary.map(m => ({ muscle: m, role: 'secondary' as const })),
  ],
})

// 6-exercise leg day: two glute-main exercises, one glute-secondary.
const legDay = [
  ex('squat', ['quads'], ['glutes']),
  ex('hip-thrust', ['glutes']),
  ex('rdl', ['hamstrings'], ['glutes']),
  ex('glute-kickback', ['glutes']),
  ex('leg-extension', ['quads']),
  ex('calf-raise', ['calves']),
]

describe('computePerExerciseDeload — no-op cases', () => {
  it('returns none with no sore muscles', () => {
    const r = computePerExerciseDeload(legDay, [], 'powerbuilding', 'accumulation')
    expect(r.outcome).toBe('none')
    expect(r.deloadedIds.size).toBe(0)
  })

  it('returns none during a deload phase — the whole session is already deloaded', () => {
    const r = computePerExerciseDeload(legDay, ['glutes'], 'powerbuilding', 'deload')
    expect(r.outcome).toBe('none')
  })

  it('returns none when soreness matches no main-role muscle', () => {
    const r = computePerExerciseDeload(legDay, ['biceps'], 'powerbuilding', 'accumulation')
    expect(r.outcome).toBe('none')
  })
})

describe('computePerExerciseDeload — main-role matching only', () => {
  it('deloads main-role matches and ignores secondary involvement', () => {
    // glutes: main on hip-thrust + glute-kickback; secondary on squat + rdl.
    const r = computePerExerciseDeload(legDay, ['glutes'], 'powerbuilding', 'accumulation')
    expect(r.outcome).toBe('per_exercise')
    expect([...r.deloadedIds].sort()).toEqual(['glute-kickback', 'hip-thrust'])
  })

  it('matches broad mood labels through moodMuscleMatches (Back covers lats)', () => {
    const pullDay = [ex('row', ['lats']), ex('curl', ['biceps']), ex('facepull', ['rear delts'])]
    const r = computePerExerciseDeload(pullDay, ['Back'], 'powerbuilding', 'accumulation')
    expect(r.outcome).toBe('per_exercise')
    expect([...r.deloadedIds]).toEqual(['row'])
  })
})

describe('computePerExerciseDeload — escalation thresholds', () => {
  it('3 of 6 affected → per_exercise (half is the boundary, inclusive)', () => {
    const r = computePerExerciseDeload(
      legDay, ['glutes', 'calves'], 'powerbuilding', 'accumulation',
    ) // hip-thrust, glute-kickback, calf-raise = 3 of 6
    expect(r.outcome).toBe('per_exercise')
    expect(r.deloadedIds.size).toBe(3)
  })

  it('4 of 6 affected → whole_session', () => {
    const r = computePerExerciseDeload(
      legDay, ['glutes', 'calves', 'hamstrings'], 'powerbuilding', 'accumulation',
    ) // hip-thrust, glute-kickback, calf-raise, rdl = 4 of 6
    expect(r.outcome).toBe('whole_session')
    expect(r.deloadedIds.size).toBe(0)
  })

  it('1-exercise session with that exercise sore → whole_session (degenerate case)', () => {
    const r = computePerExerciseDeload([ex('squat', ['quads'])], ['quads'], 'powerbuilding', 'accumulation')
    expect(r.outcome).toBe('whole_session')
  })

  it('whole_session reports which sore muscles matched', () => {
    const r = computePerExerciseDeload(
      legDay, ['glutes', 'calves', 'hamstrings'], 'powerbuilding', 'accumulation',
    )
    expect(r.matchedMuscles.sort()).toEqual(['calves', 'glutes', 'hamstrings'])
  })
})

describe('computePerExerciseDeload — override values and notes', () => {
  it('uses the per-goal deload constants (powerbuilding: 52% × 8 × 2 sets, 120s rest)', () => {
    const r = computePerExerciseDeload(legDay, ['glutes'], 'powerbuilding', 'accumulation')
    expect(r.override).toEqual({ sets: 2, reps: 8, pct: 52, restSec: 120 })
  })

  it('falls back to 50% × 8 for an unknown goal', () => {
    const r = computePerExerciseDeload(legDay, ['glutes'], 'mystery-goal', 'accumulation')
    expect(r.override).toEqual({ sets: 2, reps: 8, pct: 50, restSec: 120 })
  })

  it('writes a note naming the sore muscle for each deloaded exercise', () => {
    const r = computePerExerciseDeload(legDay, ['glutes'], 'powerbuilding', 'accumulation')
    expect(r.notes['hip-thrust']).toBe('Deload — glutes still sore')
    expect(r.notes['glute-kickback']).toBe('Deload — glutes still sore')
    expect(r.notes['squat']).toBeUndefined()
  })

  it('joins multiple matched muscles in one note', () => {
    const combo = [ex('thruster', ['glutes', 'quads']), ex('curl', ['biceps']), ex('row', ['lats'])]
    const r = computePerExerciseDeload(combo, ['glutes', 'quads'], 'powerbuilding', 'accumulation')
    expect(r.notes['thruster']).toBe('Deload — glutes & quads still sore')
  })
})
