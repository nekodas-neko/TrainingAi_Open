import { describe, it, expect } from 'vitest'
import { assembleLocalActiveProgram, exerciseLibraryRowsFrom, type LocalProgramRows } from '../local-store/program-assembler'

function baseRows(): LocalProgramRows {
  return {
    programs: [
      { id: 'p1', name: 'Inactive', isActive: false, phaseMode: 'manual', trainingGoal: 'strength',
        startedAt: null, sessionsPerCycle: null, totalWeeks: null, autoApplyPrescriptions: false,
        createdAt: null, updatedAt: '2026-06-01T00:00:00.000Z' },
      { id: 'p2', name: 'Active', isActive: true, phaseMode: 'automatic', trainingGoal: 'hypertrophy',
        startedAt: '2026-06-01', sessionsPerCycle: 3, totalWeeks: 8, autoApplyPrescriptions: true,
        createdAt: null, updatedAt: '2026-06-02T00:00:00.000Z' },
    ],
    sessions: [
      { id: 's2', programId: 'p2', name: 'Pull', position: 1, icon: null, timeBudgetMinutes: 60 },
      { id: 's1', programId: 'p2', name: 'Push', position: 0, icon: null, timeBudgetMinutes: 60 },
      { id: 'sx', programId: 'p1', name: 'Other', position: 0, icon: null, timeBudgetMinutes: 60 },
    ],
    exercises: [
      { id: 'e2', sessionId: 's1', exerciseName: 'Incline', styleId: 'st1', muscleGroups: ['chest'], position: 1, exerciseRole: 'secondary' },
      { id: 'e1', sessionId: 's1', exerciseName: 'Bench', styleId: 'st1', muscleGroups: ['chest'], position: 0, exerciseRole: 'primary' },
      { id: 'e3', sessionId: 's2', exerciseName: 'Row', styleId: null, muscleGroups: ['back'], position: 0, exerciseRole: 'primary' },
    ],
    styles: [{ id: 'st1', name: 'Linear', updatedAt: '2026-06-01T00:00:00.000Z' }],
    styleSets: [
      { id: 'ss2', styleId: 'st1', setNumber: 2, pct: 80, reps: 5, restSec: 120, useFor1rm: true },
      { id: 'ss1', styleId: 'st1', setNumber: 1, pct: 70, reps: 8, restSec: 90, useFor1rm: false },
    ],
  }
}

describe('assembleLocalActiveProgram', () => {
  it('returns null when there are no programs', () => {
    expect(assembleLocalActiveProgram({ programs: [], sessions: [], exercises: [], styles: [], styleSets: [] })).toBeNull()
  })

  it('picks the active program and exposes its metadata', () => {
    const prog = assembleLocalActiveProgram(baseRows())!
    expect(prog.id).toBe('p2')
    expect(prog.name).toBe('Active')
    expect(prog.phaseMode).toBe('automatic')
    expect(prog.trainingGoal).toBe('hypertrophy')
  })

  it('falls back to the first program when none is active', () => {
    const rows = baseRows()
    rows.programs = rows.programs.map(p => ({ ...p, isActive: false }))
    expect(assembleLocalActiveProgram(rows)!.id).toBe('p1')
  })

  it('orders sessions and exercises by position and scopes them to the active program', () => {
    const prog = assembleLocalActiveProgram(baseRows())!
    expect(prog.sessions.map(s => s.name)).toEqual(['Push', 'Pull'])
    expect(prog.sessions[0].exercises.map(e => e.name)).toEqual(['Bench', 'Incline'])
    // Session belonging to the inactive program is excluded
    expect(prog.sessions.some(s => s.name === 'Other')).toBe(false)
  })

  it('resolves per-set progression (ordered by set number) and style name', () => {
    const prog = assembleLocalActiveProgram(baseRows())!
    const bench = prog.sessions[0].exercises[0]
    expect(bench.styleName).toBe('Linear')
    expect(bench.styleId).toBe('st1')
    expect(bench.defaultSets).toBe(2)
    expect(bench.progressionStyle).toEqual([
      { pct: 70, reps: 8, restSec: 90, useFor1rm: false },
      { pct: 80, reps: 5, restSec: 120, useFor1rm: true },
    ])
  })

  it('leaves progression null and defaults to 3 sets for an exercise with no style', () => {
    const prog = assembleLocalActiveProgram(baseRows())!
    const row = prog.sessions[1].exercises[0]
    expect(row.name).toBe('Row')
    expect(row.styleId).toBeUndefined()
    expect(row.styleName).toBeNull()
    expect(row.progressionStyle).toBeNull()
    expect(row.defaultSets).toBe(3)
  })

  it('nulls out server-computed fields so offline render stays structural', () => {
    const bench = assembleLocalActiveProgram(baseRows())!.sessions[0].exercises[0]
    expect(bench.latestWeight).toBeNull()
    expect(bench.estimated1rm).toBeNull()
    expect(bench.lastDate).toBeNull()
    expect(bench.loggedTodayInSession).toBe(false)
  })
})

describe('exercise typing from the mirrored catalogue (Q-20)', () => {
  const rowsWithLibrary = (library: LocalProgramRows['library']): LocalProgramRows =>
    ({ ...baseRows(), library })

  it('falls back to weighted when the mirror has no entry — the pre-Q-20 behaviour', () => {
    const ex = assembleLocalActiveProgram(baseRows())!.sessions[0].exercises[0]
    expect(ex.exerciseType).toBe('weighted')
  })

  it('types a bodyweight movement from the mirror instead of assuming kg', () => {
    const name = 'Bench' // position 0 in session s1 — the assembler sorts by position
    const prog = assembleLocalActiveProgram(rowsWithLibrary([{
      nameKey: name.toLowerCase(), id: null, name, exerciseType: 'bodyweight',
      muscles: [{ muscle: 'lats', role: 'main' }, { muscle: 'biceps', role: 'secondary' }],
      equipment: null, updatedAt: '2026-07-28',
    }]))!
    const ex = prog.sessions[0].exercises[0]
    expect(ex.exerciseType).toBe('bodyweight')
    expect(ex.mainMuscles).toEqual(['lats'])
    expect(ex.secondaryMuscles).toEqual(['biceps'])
  })

  it('matches case-insensitively — the mirror keys on the lower-cased name, as the server does', () => {
    const name = 'Bench' // position 0 in session s1 — the assembler sorts by position
    const prog = assembleLocalActiveProgram(rowsWithLibrary([{
      nameKey: name.toLowerCase(), id: null, name: name.toUpperCase(), exerciseType: 'bodyweight',
      muscles: [], equipment: null, updatedAt: '2026-07-28',
    }]))!
    expect(prog.sessions[0].exercises[0].exerciseType).toBe('bodyweight')
  })
})

describe('exerciseLibraryRowsFrom', () => {
  const at = '2026-07-28T00:00:00.000Z'

  it('splits main and secondary muscles into role-tagged rows', () => {
    const [row] = exerciseLibraryRowsFrom([{
      name: 'Pull-Up', exerciseType: 'bodyweight',
      mainMuscles: ['lats'], secondaryMuscles: ['biceps'], equipment: ['bar'],
    }], at)
    expect(row.nameKey).toBe('pull-up')
    expect(row.exerciseType).toBe('bodyweight')
    expect(row.muscles).toEqual([
      { muscle: 'lats', role: 'main' },
      { muscle: 'biceps', role: 'secondary' },
    ])
    expect(row.equipment).toBe('bar')
  })

  it('dedupes repeats of the same exercise, keeping the last', () => {
    const rows = exerciseLibraryRowsFrom([
      { name: 'Squat', exerciseType: 'weighted', mainMuscles: [], secondaryMuscles: [], equipment: [] },
      { name: 'squat', exerciseType: 'bodyweight', mainMuscles: [], secondaryMuscles: [], equipment: [] },
    ], at)
    expect(rows).toHaveLength(1)
    expect(rows[0].exerciseType).toBe('bodyweight')
  })

  it('skips nameless entries rather than writing a junk key', () => {
    expect(exerciseLibraryRowsFrom([
      { name: '', exerciseType: 'weighted', mainMuscles: [], secondaryMuscles: [], equipment: [] },
    ], at)).toEqual([])
  })
})
