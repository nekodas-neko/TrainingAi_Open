// `POST /api/day-checkin` with a body of exactly `{}` returned 201 and wrote a row with every
// metric null (Q-465). That row is indistinguishable from a real check-in in which the user
// answered nothing, and readiness is the one pillar where "told us nothing" and "told us they feel
// neutral" must not collapse to the same value.
//
// The cases below are split between "must reject" and "must accept". The accept half is the one
// that matters for regression risk: both live writers initialise their state from NEUTRAL_SCALES
// rather than from null, so they always send numeric scales — a guard that rejected those would
// break a Save button on a screen where the user did answer.
import { describe, it, expect } from 'vitest'
import { dayCheckinHasAnswers } from '../day-checkin'

describe('dayCheckinHasAnswers', () => {
  it('rejects an empty body', () => {
    expect(dayCheckinHasAnswers({})).toBe(false)
  })

  it('rejects addressing without answers', () => {
    // `phase` and `date` say WHICH check-in, not what it says.
    expect(dayCheckinHasAnswers({ phase: 'morning', date: '2026-08-23' })).toBe(false)
  })

  it('rejects the touched flags on their own', () => {
    // They describe whether a score-derived prefill was accepted. Without the scale they describe
    // they carry nothing — and accepting them would let the exact hollow row back in.
    expect(dayCheckinHasAnswers({
      perceivedRecoveryTouched: true, sleepQualityFeelTouched: true,
    })).toBe(false)
  })

  it('rejects a body whose every answer column is explicitly null', () => {
    expect(dayCheckinHasAnswers({
      physicalTiredness: null, mentalDrain: null, barelyMoved: null, hydration: null,
      lateHeavyMeal: null, wakeMood: null, perceivedRecovery: null, motivation: null,
      sleepQualityFeel: null, restingSoreness: null,
      illnessContext: null, journal: null, soreMuscles: [],
    })).toBe(false)
  })

  it('rejects whitespace as a journal', () => {
    expect(dayCheckinHasAnswers({ journal: '   \n ' })).toBe(false)
  })

  it('accepts any single scale', () => {
    for (const key of [
      'physicalTiredness', 'mentalDrain', 'barelyMoved', 'hydration', 'lateHeavyMeal',
      'wakeMood', 'perceivedRecovery', 'motivation', 'sleepQualityFeel', 'restingSoreness',
    ]) {
      expect(dayCheckinHasAnswers({ [key]: 3 })).toBe(true)
    }
  })

  it('accepts a scale of 0 rather than treating it as absent', () => {
    // Outside the 1–5 range the schema enforces, but the predicate must not be the thing that
    // decides that — a falsy-check here would silently reclassify a value the schema rejects.
    expect(dayCheckinHasAnswers({ hydration: 0 })).toBe(true)
  })

  it('accepts an illness context, a journal, or sore muscles on their own', () => {
    expect(dayCheckinHasAnswers({ illnessContext: 'sick' })).toBe(true)
    expect(dayCheckinHasAnswers({ journal: 'slept badly' })).toBe(true)
    expect(dayCheckinHasAnswers({ soreMuscles: ['quads'] })).toBe(true)
  })

  it('accepts what the two live writers actually send', () => {
    // The morning sheet: two prefilled numeric scales plus retired nulls.
    expect(dayCheckinHasAnswers({
      phase: 'morning', perceivedRecovery: 3, sleepQualityFeel: 3,
      perceivedRecoveryTouched: false, sleepQualityFeelTouched: false,
      illnessContext: null, motivation: null, restingSoreness: null, wakeMood: null,
      soreMuscles: [], journal: null,
    })).toBe(true)
    // The evening review: five numeric scales.
    expect(dayCheckinHasAnswers({
      phase: 'evening', physicalTiredness: 2, mentalDrain: 2, barelyMoved: 1,
      hydration: 4, lateHeavyMeal: 1, soreMuscles: [], journal: null,
    })).toBe(true)
  })
})
