// #3890: every row of the "What the answers do" table, one rule each (decisions 8 and 9).
import { describe, it, expect } from 'vitest'
import { daysOffDates, effectForAnswer, holdUnderCheckin, isAutomaticEffect } from '../effects'
import type { SessionRead } from '../../ai-periodization/session-read'

describe('effectForAnswer', () => {
  it('Heavy holds the lift, by itself', () => {
    expect(effectForAnswer('heavy', false)).toBe('held')
    expect(effectForAnswer('heavy', null)).toBe('held') // no read of the lift: hold, never lower
    expect(isAutomaticEffect('held')).toBe(true)
  })
  it('Heavy and a missed rep lowers it one step, by itself (decision 9)', () => {
    expect(effectForAnswer('heavy', true)).toBe('lowered_one_step')
    expect(isAutomaticEffect('lowered_one_step')).toBe(true)
  })
  it('Light only offers a step up', () => {
    expect(effectForAnswer('light', false)).toBe('offered_step_up')
    expect(effectForAnswer('light', true)).toBe('offered_step_up')
    expect(isAutomaticEffect('offered_step_up')).toBe(false)
  })
  it('About right does nothing, with or without a miss', () => {
    expect(effectForAnswer('about_right', true)).toBe('none')
    expect(effectForAnswer('about_right', null)).toBe('none')
  })
})

describe('daysOffDates', () => {
  it('maps ISO weekdays onto the week the answer is for, sorted, without repeats', () => {
    expect(daysOffDates('2026-11-23', [7, 3, 3], '2026-11-22')).toEqual(['2026-11-25', '2026-11-29'])
  })
  it('skips today and earlier: today is the person\'s own rest-day tap', () => {
    expect(daysOffDates('2026-11-23', [1, 2], '2026-11-23')).toEqual(['2026-11-24'])
  })
  it('crosses New Year', () => {
    expect(daysOffDates('2026-12-28', [4, 5], '2026-12-27')).toEqual(['2026-12-31', '2027-01-01'])
  })
  it('ignores anything outside 1-7', () => {
    expect(daysOffDates('2026-11-23', [0, 8, 1.5], '2026-11-22')).toEqual([])
  })
})

const read = (over: Partial<SessionRead>): SessionRead => ({
  verdict: 'hold', nextLoad: 'as-today', band: null, unexplainedReps: 0, targetReps: 15, effort: null,
  restShort: false, easierWithMiss: false, hrRead: false, sets: [], ...over,
})

describe('a Heavy answer feeds the session read: it never adds load', () => {
  it('a read that would add weight or reps holds the last bar', () => {
    expect(holdUnderCheckin(read({ verdict: 'progress-load', nextLoad: 'as-today' }))).toMatchObject({ verdict: 'hold', nextLoad: 'hold', checkinHeld: true })
    expect(holdUnderCheckin(read({ verdict: 'progress-load', nextLoad: 'up-1' }))).toMatchObject({ verdict: 'hold', nextLoad: 'hold' })
    expect(holdUnderCheckin(read({ verdict: 'progress-reps', nextLoad: 'hold' }))).toMatchObject({ verdict: 'hold', nextLoad: 'hold' })
    expect(holdUnderCheckin(read({ verdict: 'hold', nextLoad: 'as-today' }))).toMatchObject({ verdict: 'hold', nextLoad: 'hold' })
  })
  it('a read that holds or lowers already is left as it is', () => {
    expect(holdUnderCheckin(read({ verdict: 'reduce', nextLoad: 'down-1' }))).toMatchObject({ verdict: 'reduce', nextLoad: 'down-1', checkinHeld: true })
    expect(holdUnderCheckin(read({ verdict: 'hold-rest-more', nextLoad: 'hold' }))).toMatchObject({ verdict: 'hold-rest-more', nextLoad: 'hold' })
  })
  it('a read that cannot judge has no bar to hold to', () => {
    const r = read({ verdict: 'too-little-data', why: 'no-sets' })
    expect(holdUnderCheckin(r)).toBe(r)
  })
})
