// #2601 (owner approved 2026-10-07): hrr1_best is the max of the session's HRR60, null where no set has one.
import { describe, it, expect } from 'vitest'
import { planHrr1BestRecompute, summariseHrr1BestChanges } from '../hrr1-best-recompute'

const at = new Date('2026-09-20T08:00:00Z')
const row = (id: string, hrr1Best: number | null, maxSetHrr60: number | null) => ({ workoutSessionId: id, startedAt: at, hrr1Best, maxSetHrr60 })

describe('planHrr1BestRecompute', () => {
  it('clears a ring-only session, corrects a strap one, and leaves a settled one alone', () => {
    const changes = planHrr1BestRecompute([
      row('ring', 23, null),     // nearest-reading noise, no dense HR: goes to null
      row('strap', 31, 36),      // the dense measurement wins
      row('done', 40, 40),
      row('gain', null, 28),     // a session whose old value was missing but a set has HRR60
    ])
    expect(changes.map(c => [c.workoutSessionId, c.before, c.after])).toEqual([
      ['ring', 23, null], ['strap', 31, 36], ['gain', null, 28],
    ])
    expect(summariseHrr1BestChanges(changes)).toEqual({ sessionsChanged: 3, toNull: 1, fromNull: 1, valueChanged: 1 })
  })

  it('is idempotent: applied changes plan nothing', () => {
    const once = planHrr1BestRecompute([row('a', 23, null), row('b', 31, 36)])
    expect(planHrr1BestRecompute(once.map(c => row(c.workoutSessionId, c.after, c.after)))).toEqual([])
  })
})
