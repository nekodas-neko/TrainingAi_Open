// LA-65 — the owner wants to "mix and match" 2-set and 3-set exercises inside one session
// (2026-09-28). Checked: the budget stage sizes sets PER EXERCISE, one set at a time by role
// priority, so a session comes out mixed rather than uniform. This pins that, so a future change
// cannot quietly force every exercise to the same count.
import { describe, it, expect } from 'vitest'
import { expandToBudget } from '../time-budget'
import { transitionSecForEquipment } from '../../workout/duration-model'

const ex = (id: string, role: string, reps: number, rest: number, eq: string) =>
  ({ sessionExerciseId: id, role, sets: 2, reps, restSec: rest, transitionSec: transitionSecForEquipment([eq]) })

describe('set counts are sized per exercise (LA-65)', () => {
  it('a five-exercise session given more time comes out with mixed set counts', () => {
    const session = [
      ex('p', 'primary', 5, 180, 'barbell'), ex('s1', 'secondary', 8, 120, 'barbell'),
      ex('s2', 'secondary', 8, 120, 'cable'), ex('a1', 'accessory', 12, 60, 'dumbbell'),
      ex('a2', 'accessory', 12, 60, 'cable'),
    ]
    const sets = expandToBudget(session, 45).map(e => e.sets)
    expect(new Set(sets).size).toBeGreaterThan(1)
    expect(Math.min(...sets)).toBeGreaterThanOrEqual(2)
  })
})
