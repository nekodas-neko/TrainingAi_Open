// #3890: the week in three lines, from numbers code worked out (no model). Fake lift names.
import { describe, it, expect } from 'vitest'
import { directionOf, missedRepInWeek, summarizeWeek } from '../summary'
import type { SessionRead, SessionReadSetResult } from '../../ai-periodization/session-read'

const set = (cls: SessionReadSetResult['cls'], missReps = 0): SessionReadSetResult => ({ setNumber: 1, cls, missReps, excusedReps: 0, restBeforeRatio: null })
const read = (over: Partial<SessionRead>): SessionRead => ({
  verdict: 'hold', nextLoad: 'as-today', band: null, unexplainedReps: 0, targetReps: 15, effort: null,
  restShort: false, easierWithMiss: false, hrRead: false, sets: [set('met'), set('met')], ...over,
})

describe('directionOf: what the session read says, in words the card can show', () => {
  it.each([
    [read({ verdict: 'progress-load' }), 'up', 'more_load'],
    [read({ verdict: 'progress-reps', nextLoad: 'hold' }), 'up', 'more_reps'],
    [read({ verdict: 'reduce', nextLoad: 'down-1', band: 'clear' }), 'down', 'missed_reps'],
    [read({ verdict: 'hold-rest-more', nextLoad: 'hold', band: 'none' }), 'held', 'short_rest'],
    [read({ verdict: 'hold-recovery', nextLoad: 'hold' }), 'held', 'heart_rate'],
    [read({ verdict: 'hold', nextLoad: 'hold', band: 'small' }), 'held', 'missed_reps'],
    [read({ verdict: 'hold', nextLoad: 'hold', effort: 1 }), 'held', 'felt_hard'],
    [read({ verdict: 'hold', nextLoad: 'hold', band: 'small', easierWithMiss: true }), 'held', 'logging_slip'],
    [read({ verdict: 'hold', nextLoad: 'as-today' }), 'steady', null],
    [read({ verdict: 'too-little-data', why: 'no-sets' }), 'unknown', null],
  ] as const)('%#', (r, direction, why) => {
    expect(directionOf(r)).toEqual({ direction, why })
  })
})

describe('missedRepInWeek (decision 9\'s "missed rep")', () => {
  it('a set short of its planned reps in any session of the week', () => {
    expect(missedRepInWeek([{ day: 'd1', read: read({}) }, { day: 'd2', read: read({ sets: [set('met'), set('miss', 1)] }) }])).toBe(true)
  })
  it('a heavier set the lifter chose, or none missed, is not a miss', () => {
    expect(missedRepInWeek([{ day: 'd1', read: read({ sets: [set('miss-self-heavier', 2), set('beat')] }) }])).toBe(false)
  })
  it('no readable session is no answer, not "no miss"', () => {
    expect(missedRepInWeek([])).toBeNull()
    expect(missedRepInWeek([{ day: 'd1', read: read({ verdict: 'too-little-data', sets: [] }) }])).toBeNull()
  })
})

describe('summarizeWeek', () => {
  it('three lines from the numbers, and the numbers beside them', () => {
    const s = summarizeWeek({
      sessionsDone: 3, sessionsPlanned: 4,
      lifts: [
        { exerciseName: 'Lift A', exerciseId: 'id-a', reads: [{ day: '2026-11-16', read: read({ verdict: 'progress-load' }) }] },
        { exerciseName: 'Lift B', exerciseId: null, reads: [
          { day: '2026-11-16', read: read({ verdict: 'hold-rest-more', nextLoad: 'hold', band: 'none', sets: [set('met'), set('miss', 1)] }) },
          { day: '2026-11-18', read: read({ verdict: 'hold-rest-more', nextLoad: 'hold', band: 'none' }) },
        ] },
        { exerciseName: 'Lift C', exerciseId: null, reads: [{ day: '2026-11-18', read: read({ verdict: 'reduce', nextLoad: 'down-1', band: 'clear', sets: [set('miss', 3), set('met')] }) }] },
        { exerciseName: 'Lift D', exerciseId: null, reads: [] },
      ],
    })
    expect(s.lines).toEqual([
      '3 of 4 planned sessions done.',
      'Going up: Lift A (more weight). Holding: Lift B (short rest). Coming down: Lift C (a rep short).',
      'Weight held for short rest on 2 days.',
    ])
    expect(s.shortRestDays).toBe(2)
    expect(s.lifts.map(l => [l.exerciseName, l.direction, l.missedRep, l.sessions])).toEqual([
      ['Lift A', 'up', false, 1], ['Lift B', 'held', true, 2], ['Lift C', 'down', true, 1], ['Lift D', 'unknown', null, 0],
    ])
  })

  it('the latest judged read wins over an older one, and a later unreadable one does not hide it', () => {
    const s = summarizeWeek({ sessionsDone: 2, sessionsPlanned: 2, lifts: [{ exerciseName: 'Lift A', exerciseId: null, reads: [
      { day: 'd1', read: read({ verdict: 'reduce', nextLoad: 'down-1', band: 'clear' }) },
      { day: 'd2', read: read({ verdict: 'progress-load' }) },
      { day: 'd3', read: read({ verdict: 'too-little-data', sets: [] }) },
    ] }] })
    expect(s.lifts[0].direction).toBe('up')
  })

  it('singular wording, no planned count, nothing logged', () => {
    expect(summarizeWeek({ sessionsDone: 1, sessionsPlanned: 1, lifts: [] }).lines)
      .toEqual(['1 of 1 planned session done.', 'No main lift logged this week.', 'No day held for short rest.'])
    expect(summarizeWeek({ sessionsDone: 1, sessionsPlanned: 0, lifts: [] }).lines[0]).toBe('1 session done.')
  })
})
