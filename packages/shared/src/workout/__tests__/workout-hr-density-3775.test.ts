// #3775 — one density rule for a workout's heart rate: the verdict the calorie gate reads (moved here
// from the Postgres slice) and the per-set check the recap reads before it shows a figure.
import { describe, expect, it } from 'vitest'
import {
  setHrMeasured, showSetHr, workoutHrSpanVerdict, SET_HR_WINDOW_MS, SPARSE_WORKOUT_HR_NOTE, SET_HR_NOT_MEASURED,
} from '../workout-hr-density'
import { HR_DENSE_MAX_GAP_MS } from '../../health/intraday-hr-contributors'

const T0 = new Date('2026-11-10T02:00:00Z') // local midday in Brisbane
const at = (ms: number) => ({ timestamp: new Date(T0.getTime() + ms) })

describe('workoutHrSpanVerdict (#3078, #3775)', () => {
  it('has nothing to judge without a reading', () => {
    expect(workoutHrSpanVerdict(null)).toBeNull()
    expect(workoutHrSpanVerdict({ n: 0, ungated: 0, max_gap_ms: null })).toBeNull()
  })
  it('passes any series with a reading from an ungated source', () => {
    expect(workoutHrSpanVerdict({ n: 1, ungated: 1, max_gap_ms: null })).toBe(true)
  })
  it('holds a gated series to the density rule, at its exact edge', () => {
    expect(workoutHrSpanVerdict({ n: 1, ungated: 0, max_gap_ms: null })).toBe(false)
    expect(workoutHrSpanVerdict({ n: 12, ungated: 0, max_gap_ms: HR_DENSE_MAX_GAP_MS })).toBe(true)
    expect(workoutHrSpanVerdict({ n: 12, ungated: 0, max_gap_ms: HR_DENSE_MAX_GAP_MS + 1000 })).toBe(false)
  })
  it('reads the numbers Postgres sends as strings', () => {
    expect(workoutHrSpanVerdict({ n: '9', ungated: '0', max_gap_ms: '420000' } as never)).toBe(false)
  })
})

describe('setHrMeasured (#3775)', () => {
  const logged = new Date(T0.getTime() + 10 * 60_000)
  const near = (offsetMs: number) => ({ timestamp: new Date(logged.getTime() + offsetMs) })

  it('is false with no reading or one reading around the set', () => {
    expect(setHrMeasured([], logged)).toBe(false)
    expect(setHrMeasured([near(-20_000)], logged)).toBe(false)
    expect(setHrMeasured([near(-20_000), near(SET_HR_WINDOW_MS + 1000)], logged)).toBe(false)
  })
  it('is true with two readings inside the window', () => {
    expect(setHrMeasured([near(-SET_HR_WINDOW_MS), near(SET_HR_WINDOW_MS)], logged)).toBe(true)
  })
  it('a strap second-by-second series passes; a reading every few minutes does not', () => {
    const strap = Array.from({ length: 3600 }, (_, i) => at(i * 1000))
    const cloud = Array.from({ length: 12 }, (_, i) => at(i * 5 * 60_000 + 30_000))
    expect(setHrMeasured(strap, logged)).toBe(true)
    expect(setHrMeasured(cloud, new Date(T0.getTime() + 13 * 60_000))).toBe(false)
  })
  it('is false for a set with no log time', () => {
    expect(setHrMeasured([near(0), near(1000)], null)).toBe(false)
  })
})

describe('showSetHr (#3775)', () => {
  it('hides everything on a sparse workout, and an unmeasured set on any workout', () => {
    expect(showSetHr(false, true)).toBe(false)
    expect(showSetHr(true, false)).toBe(false)
    expect(showSetHr(null, false)).toBe(false)
  })
  it('shows a measured set on a dense or unjudged workout', () => {
    expect(showSetHr(true, true)).toBe(true)
    expect(showSetHr(null, true)).toBe(true)
    expect(showSetHr(undefined, undefined)).toBe(true) // an older response without the fields
  })
  it('says why in plain words', () => {
    expect(SPARSE_WORKOUT_HR_NOTE).toMatch(/chest strap/)
    expect(SET_HR_NOT_MEASURED).toMatch(/Too few heart-rate readings/)
  })
})
