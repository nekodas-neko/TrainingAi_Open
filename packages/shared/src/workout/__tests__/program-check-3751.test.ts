// #3751. The three things the generate-program prompt asked the model to confirm for itself —
// session minutes, weekly sets per large muscle, back-to-back muscles — checked in code, and the one
// that code can repair (time) repaired in the order the prompt states.
import { describe, it, expect } from 'vitest'
import { backToBackPairs, checkGeneratedProgram, sessionRunsPerWeek, type ProgramCheckInput } from '../program-check'
import { splitForDays } from '../program-split'
import { equipmentFromNamePrefix, equipmentLedByName } from '../equipment'
import type { GeneratedExercise, GeneratedSession } from '../../types/builder'

// 4 × 12 @ 60s and 3 × 12 @ 60s: 412 s and 294 s of work before setup overhead.
const STYLES = new Map([
  ['s4', Array(4).fill({ reps: 12, restSec: 60 })],
  ['s3', Array(3).fill({ reps: 12, restSec: 60 })],
])
const EQUIPMENT: Record<string, string[]> = {
  'Bench Press': ['barbell'], 'Barbell Row': ['barbell'], 'Squat': ['barbell'],
  'Cable Fly': ['cable'], 'Dumbbell Curl': ['dumbbell'], 'Triceps Pushdown': ['cable'],
  'Lateral Raise': ['dumbbell'], 'Lat Pulldown': ['cable'],
}

const ex = (name: string, role: GeneratedExercise['exerciseRole'], main: string[], styleId = 's4', secondary: string[] = []): GeneratedExercise =>
  ({ name, exerciseRole: role, mainMuscles: main, secondaryMuscles: secondary, progressionStyleId: styleId })
const session = (name: string, exercises: GeneratedExercise[]): GeneratedSession => ({ name, icon: '🏋️', exercises })

const base = (over: Partial<ProgramCheckInput>): ProgramCheckInput => ({
  sessions: [],
  goal: 'hypertrophy',
  timePerSessionMinutes: null,
  schedule: { type: 'rotation', restAfterN: 1 },
  styleSetsById: STYLES,
  equipmentOf: name => EQUIPMENT[name],
  focusMuscles: new Set(),
  ...over,
})

describe('over the time budget: trimmed in code', () => {
  // 412 + (412+240) + 4 × (294+120) = 2720 s against a 30-minute session's 26 working minutes (1560 s).
  const push = session('Push', [
    ex('Bench Press', 'primary', ['Chest']),
    ex('Barbell Row', 'secondary', ['Lats']),
    ex('Cable Fly', 'accessory', ['Chest'], 's3'),
    ex('Lateral Raise', 'accessory', ['Shoulders'], 's3'),
    ex('Dumbbell Curl', 'accessory', ['Biceps'], 's3'),
    ex('Triceps Pushdown', 'accessory', ['Triceps'], 's3'),
  ])

  it('removes small-muscle accessories first, last listed first, and stops once it fits', () => {
    const result = checkGeneratedProgram(base({ sessions: [push], timePerSessionMinutes: 30 }))
    expect(result.budgetMin).toBe(26)
    expect(result.trimmed.map(t => t.exercise)).toEqual(['Triceps Pushdown', 'Dumbbell Curl', 'Lateral Raise'])
    // The large-muscle accessory survives: three small-muscle cuts were enough.
    expect(result.sessions[0].exercises.map(e => e.name)).toEqual(['Bench Press', 'Barbell Row', 'Cable Fly'])
    expect(result.overBudget).toEqual([])
    expect(result.notes).toContain('Removed Triceps Pushdown from Push to fit the 30-minute session.')
    // The input is the model's program as resolved; it is not edited in place.
    expect(push.exercises).toHaveLength(6)
  })

  it('then large-muscle accessories, never a compound, and says when that is not enough', () => {
    const heavy = session('Legs', [
      ex('Squat', 'primary', ['Quads']),
      ex('Bench Press', 'secondary', ['Chest']),
      ex('Barbell Row', 'secondary', ['Lats']),
      ex('Cable Fly', 'accessory', ['Chest'], 's3'),
      ex('Lateral Raise', 'accessory', ['Shoulders'], 's3'),
    ])
    // 412 + 652 + 652 = 1716 s of compounds alone, over 1560.
    const result = checkGeneratedProgram(base({ sessions: [heavy], timePerSessionMinutes: 30 }))
    expect(result.trimmed.map(t => t.exercise)).toEqual(['Lateral Raise', 'Cable Fly'])
    expect(result.sessions[0].exercises.map(e => e.exerciseRole)).toEqual(['primary', 'secondary', 'secondary'])
    expect(result.overBudget).toEqual([{ session: 'Legs', minutes: 29 }])
    expect(result.notes).toContain('Legs is estimated at 29 working minutes, over the 26 a 30-minute session leaves after warm-up.')
  })

  it('never trims a session to nothing: an all-accessory day keeps its last exercise and is reported over', () => {
    // 10 × 12 @ 180 s per exercise: well over a 30-minute session's 26 working minutes on its own.
    const long = new Map([...STYLES, ['s10', Array(10).fill({ reps: 12, restSec: 180 })]])
    const arms = session('Arms', [
      ex('Dumbbell Curl', 'accessory', ['Biceps'], 's10'),
      ex('Triceps Pushdown', 'accessory', ['Triceps'], 's10'),
    ])
    const result = checkGeneratedProgram(base({ sessions: [arms], timePerSessionMinutes: 30, styleSetsById: long }))
    expect(result.sessions[0].exercises).toHaveLength(1)
    expect(result.trimmed).toHaveLength(1)
    expect(result.overBudget.map(o => o.session)).toEqual(['Arms'])
  })

  it('an over-budget note never reads as equal to the budget: minutes round up', () => {
    // A 60-minute session's budget is 51 working minutes; 3070 s is 51.2 minutes, which must read 52.
    const tight = new Map([...STYLES, ['s51', [{ reps: 12, restSec: 3070 - 40 }, { reps: 12, restSec: 0 }]]])
    const one = session('Solo', [ex('Bench Press', 'primary', ['Chest'], 's51')])
    const result = checkGeneratedProgram(base({ sessions: [one], timePerSessionMinutes: 60, styleSetsById: tight }))
    expect(result.budgetMin).toBe(51)
    for (const o of result.overBudget) expect(o.minutes).toBeGreaterThan(51)
  })

  it('trims nothing without a time limit', () => {
    const result = checkGeneratedProgram(base({ sessions: [push], timePerSessionMinutes: null }))
    expect(result.budgetMin).toBeNull()
    expect(result.trimmed).toEqual([])
    expect(result.sessions[0].exercises).toHaveLength(6)
  })
})

describe('weekly sets per large muscle', () => {
  it('reports a focused large muscle under the goal’s minimum', () => {
    // Chest: one 4-set main exercise = 4 sets, under hypertrophy's MEV of 8.
    const result = checkGeneratedProgram(base({
      sessions: [session('Push', [ex('Bench Press', 'primary', ['Chest'])])],
      focusMuscles: new Set(['chest']),
      schedule: { type: 'weekly', days: [0] },
    }))
    expect(result.underRange).toEqual([{ label: 'Chest', sets: 4, minimum: 8 }])
    expect(result.notes).toContain('Chest gets 4 sets a week, under the 8 this goal starts at.')
  })

  it('counts secondary work at half, and lats and upper back as one back exercise', () => {
    const result = checkGeneratedProgram(base({
      sessions: [
        session('Pull', [ex('Barbell Row', 'primary', ['Lats'], 's4', ['Upper Back'])]),
        session('Pull B', [ex('Lat Pulldown', 'secondary', ['Biceps'], 's4', ['Lats'])]),
      ],
      focusMuscles: new Set(['lats']),
      schedule: { type: 'weekly', days: [0, 3] },
    }))
    // 4 (main, counted once despite two back muscles) + 4 × 0.5 = 6, under back's 10.
    expect(result.underRange).toEqual([{ label: 'Back', sets: 6, minimum: 10 }])
  })

  it('does not hold a muscle the user did not ask for to its range', () => {
    const result = checkGeneratedProgram(base({
      sessions: [session('Arms', [ex('Dumbbell Curl', 'primary', ['Biceps'])])],
      focusMuscles: new Set(['biceps']),
    }))
    expect(result.underRange).toEqual([])
  })

  it('a muscle in range is not reported', () => {
    const result = checkGeneratedProgram(base({
      sessions: [
        session('Push A', [ex('Bench Press', 'primary', ['Chest'])]),
        session('Push B', [ex('Cable Fly', 'primary', ['Chest'])]),
      ],
      focusMuscles: new Set(['full body']),
      schedule: { type: 'rotation', restAfterN: 1 },
    }))
    expect(result.underRange.map(u => u.label)).not.toContain('Chest')
  })
})

describe('neighbouring sessions sharing main muscles', () => {
  it('reports sessions on consecutive days whose compounds lead with the same muscle', () => {
    const result = checkGeneratedProgram(base({
      sessions: [
        session('Push', [ex('Bench Press', 'primary', ['Chest'])]),
        session('Upper', [ex('Bench Press', 'primary', ['Chest']), ex('Barbell Row', 'secondary', ['Lats'])]),
        session('Legs', [ex('Squat', 'primary', ['Quads'])]),
      ],
      schedule: { type: 'rotation', restAfterN: 3 },
    }))
    expect(result.sharedNeighbours).toEqual([{ first: 'Push', second: 'Upper', muscles: ['chest'] }])
    expect(result.notes).toContain('Push and Upper can fall on consecutive days and both lead with Chest.')
  })

  it('an accessory alone does not make a clash', () => {
    const result = checkGeneratedProgram(base({
      sessions: [
        session('Push', [ex('Bench Press', 'primary', ['Chest'])]),
        session('Pull', [ex('Barbell Row', 'primary', ['Lats']), ex('Cable Fly', 'accessory', ['Chest'])]),
      ],
      schedule: { type: 'rotation', restAfterN: 2 },
    }))
    expect(result.sharedNeighbours).toEqual([])
  })
})

describe('backToBackPairs', () => {
  it('a rest after every cycle never puts the last session before the first', () => {
    expect(backToBackPairs(3, { type: 'rotation', restAfterN: 3 })).toEqual([[0, 1], [1, 2]])
  })

  it('a rest that drifts against the cycle eventually joins every neighbour pair', () => {
    const pairs = backToBackPairs(4, { type: 'rotation', restAfterN: 3 })
    expect(pairs).toHaveLength(4)
    expect(pairs).toContainEqual([3, 0])
  })

  it('weekly days only pair sessions on adjacent days, Sunday into Monday', () => {
    expect(backToBackPairs(3, { type: 'weekly', days: [0, 2, 4] })).toEqual([])
    expect(backToBackPairs(3, { type: 'weekly', days: [0, 1, 6] })).toEqual([[0, 1], [2, 0]])
  })

  it('one session has no neighbour but itself', () => {
    expect(backToBackPairs(1, { type: 'rotation', restAfterN: 3 })).toEqual([])
  })
})

describe('splitForDays', () => {
  it('gives one uniquely named session per training day', () => {
    for (let d = 1; d <= 7; d++) {
      const split = splitForDays(d)
      expect(split).toHaveLength(d)
      expect(new Set(split.map(s => s.name)).size).toBe(d)
      for (const s of split) expect(s.name).not.toMatch(/[()/]/)
    }
  })

  it('clamps outside 1–7', () => {
    expect(splitForDays(0)).toHaveLength(1)
    expect(splitForDays(9)).toHaveLength(7)
  })
})

describe('equipment from the name prefix', () => {
  it('reads the first word, abbreviations included', () => {
    expect(equipmentFromNamePrefix('Barbell Hip Thrust')).toBe('barbell')
    expect(equipmentFromNamePrefix('DB Curl')).toBe('dumbbell')
    expect(equipmentFromNamePrefix('Push-Up')).toBeNull()
  })

  it('puts the prefix equipment first, once', () => {
    expect(equipmentLedByName('Kettlebell Goblet Squat', ['dumbbell', 'kettlebell'])).toEqual(['kettlebell', 'dumbbell'])
    expect(equipmentLedByName('Machine Leg Press', ['barbell'])).toEqual(['machine', 'barbell'])
    expect(equipmentLedByName('Plank', ['bodyweight'])).toEqual(['bodyweight'])
  })
})

// #3840: rough edges found reviewing #3751.
describe('weekly sets weigh each session by how often it runs', () => {
  it('a rotation with a rest after every 3 runs each of 3 sessions 1.75 times a week', () => {
    expect(sessionRunsPerWeek(3, { type: 'rotation', restAfterN: 3 })).toEqual([1.75, 1.75, 1.75])
  })

  it('weekly days run the k-th day’s session k mod n, so a session can run twice or not at all', () => {
    expect(sessionRunsPerWeek(2, { type: 'weekly', days: [0, 2, 4] })).toEqual([2, 1])
    expect(sessionRunsPerWeek(3, { type: 'weekly', days: [1] })).toEqual([1, 0, 0])
  })

  it('a session run 1.75 times a week counts its sets 1.75 times', () => {
    // Chest: 4 sets in Push, run 1.75 times a week = 7, under hypertrophy's 8. Counted once it
    // was 4, which made the note fire for programs well inside the range.
    const result = checkGeneratedProgram(base({
      sessions: [
        session('Push', [ex('Bench Press', 'primary', ['Chest']), ex('Cable Fly', 'accessory', ['Chest'], 's3')]),
        session('Pull', [ex('Barbell Row', 'primary', ['Lats'])]),
        session('Legs', [ex('Squat', 'primary', ['Quads'])]),
      ],
      focusMuscles: new Set(['chest']),
      schedule: { type: 'rotation', restAfterN: 3 },
    }))
    // (4 + 3) × 1.75 = 12.25, inside the range: no note.
    expect(result.underRange).toEqual([])
  })

  it('a fractional total reads to one decimal', () => {
    const result = checkGeneratedProgram(base({
      sessions: [
        session('Push', [ex('Bench Press', 'primary', ['Chest'], 's3')]),
        session('Pull', [ex('Barbell Row', 'primary', ['Lats'])]),
        session('Legs', [ex('Squat', 'primary', ['Quads'])]),
      ],
      focusMuscles: new Set(['chest']),
      schedule: { type: 'rotation', restAfterN: 3 },
    }))
    expect(result.underRange).toEqual([{ label: 'Chest', sets: 5.3, minimum: 8 }])
    expect(result.notes).toContain('Chest gets 5.3 sets a week, under the 8 this goal starts at.')
  })
})

describe('a full-body split gets no neighbour-overlap note', () => {
  const fullBody = [
    session('Full Body A', [ex('Bench Press', 'primary', ['Chest']), ex('Squat', 'secondary', ['Quads'])]),
    session('Full Body B', [ex('Bench Press', 'primary', ['Chest']), ex('Squat', 'secondary', ['Quads'])]),
  ]

  it('two full-body sessions on a rotation share muscles by design, so it is not reported', () => {
    const result = checkGeneratedProgram(base({ sessions: fullBody, fullBodySplit: true, schedule: { type: 'rotation', restAfterN: 3 } }))
    expect(result.sharedNeighbours).toEqual([])
    expect(result.notes.some(n => n.includes('consecutive days'))).toBe(false)
  })

  it('the same sessions outside a full-body split are still reported', () => {
    const result = checkGeneratedProgram(base({ sessions: fullBody, schedule: { type: 'rotation', restAfterN: 3 } }))
    expect(result.sharedNeighbours).toHaveLength(1)
  })

  it('splitForDays marks the 1- and 2-day splits full body, and no other', () => {
    for (let d = 1; d <= 7; d++) {
      expect(splitForDays(d).every(s => s.fullBody)).toBe(d <= 2)
    }
  })
})
