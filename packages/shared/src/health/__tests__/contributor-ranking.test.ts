import { describe, it, expect } from 'vitest'
import { rankedContributors, weakestContributor } from '../contributor-ranking'
import { knownInputKeys, limitedInputsNote } from '../readiness-input-labels'
import { labelFor } from '../contributor-labels'
import { READINESS_WEIGHTS } from '../readiness-composite'

describe('weakestContributor', () => {
  it('reads both stored shapes and names the lowest', () => {
    expect(weakestContributor({ hrv_balance: 90, rem_sleep: 40 })).toEqual({ label: 'REM sleep', value: 40 })
    expect(weakestContributor({ hrvBalance: { score: 25 }, previousNight: { score: 80 } })).toEqual({ label: 'HRV balance', value: 25 })
  })
  it('is null with nothing measured', () => {
    expect(weakestContributor({ a: null, b: { score: null } })).toBeNull()
    expect(weakestContributor(null)).toBeNull()
  })
  it('ranks worst first', () => {
    expect(rankedContributors({ a: 50, b: 10, c: 30 }).map(([k]) => k)).toEqual(['b', 'c', 'a'])
  })
})

describe('readiness wording', () => {
  it('words every composite weight key as the breakdown always did', () => {
    const expected: Record<keyof typeof READINESS_WEIGHTS, string> = {
      restingHeartRate: 'Resting heart rate',
      previousNight: 'Previous night',
      hrvBalance: 'HRV balance',
      temperature: 'Body temperature',
      sleepBalance: 'Sleep balance',
      prevDayActivity: 'Previous day activity',
      recoveryIndex: 'Recovery index',
      activityBalance: 'Activity balance',
    }
    for (const key of Object.keys(READINESS_WEIGHTS) as (keyof typeof READINESS_WEIGHTS)[]) {
      expect(labelFor(key)).toBe(expected[key])
    }
  })
  it('drops an input key it has no words for', () => {
    expect(knownInputKeys(['sleep', 'futureSignal'])).toEqual(['sleep'])
  })
  it('names every missing input in words, never a raw key', () => {
    const note = limitedInputsNote(['sleep', 'hrv', 'restingHeartRate', 'temperature', 'activity'])!
    expect(note).toBe(
      'Based on part of the usual picture — no sleep stages, overnight HRV, resting heart rate, body temperature and daily activity today, so those factors sit at neutral.',
    )
    expect(note).not.toMatch(/restingHeartRate/)
  })
})
