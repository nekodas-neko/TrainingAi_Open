// #3775 — one density rule for a workout's heart rate: the verdict the calorie gate reads (moved here
// from the Postgres slice) and the per-set check the recap reads before it shows a figure.
import { describe, expect, it } from 'vitest'
import {
  setHrMeasured, showSetHr, showSparseWorkoutHrNote, workoutHrSpanVerdict, SET_HR_WINDOW_MS, SPARSE_WORKOUT_HR_NOTE,
  SET_HR_NOT_MEASURED,
} from '../workout-hr-density'
import { analyseHrRecovery, SET_PEAK_AFTER_MS, SET_PEAK_BEFORE_MS } from '../hr-analysis'
import { HR_DENSE_MAX_GAP_MS, isDenseHrSeries } from '../../health/intraday-hr-contributors'

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
  it('is true with two readings inside the peak window, at its exact edges', () => {
    expect(setHrMeasured([near(-SET_PEAK_BEFORE_MS), near(SET_PEAK_AFTER_MS)], logged)).toBe(true)
  })
  it('counts only the peak window, so a peak never rests on one reading (#3839)', () => {
    // −80 s and +40 s are both within 90 s of the log, but only −80 s is inside the peak window:
    // the peak shown would be that one reading.
    expect(setHrMeasured([near(-80_000), near(40_000)], logged)).toBe(false)
    expect(setHrMeasured([near(-SET_PEAK_BEFORE_MS - 1000), near(0)], logged)).toBe(false)
    expect(setHrMeasured([near(-SET_HR_WINDOW_MS), near(SET_HR_WINDOW_MS)], logged)).toBe(false)
    expect(setHrMeasured([near(-80_000), near(-10_000)], logged)).toBe(true)
  })
  it('agrees with the peak analyseHrRecovery shows: two readings in its window, or none shown', () => {
    const readings = [{ ...near(-80_000), bpm: 150 }, { ...near(40_000), bpm: 160 }]
    const [stat] = analyseHrRecovery(readings, [{ exerciseName: 'Squat', setNumber: 1, loggedAt: logged }])
    expect(stat.peakBpm).toBe(150) // built on the −80 s reading alone
    expect(setHrMeasured(readings, logged)).toBe(false)
  })
  it('one reading every 3 to 5 minutes passes the workout rule but no set (#3839)', () => {
    for (const stepMin of [3, 4, 5]) {
      const times = Array.from({ length: 15 }, (_, i) => T0.getTime() + i * stepMin * 60_000)
      expect(isDenseHrSeries(times)).toBe(true)
      for (let m = 1; m < 40; m++) {
        expect(setHrMeasured(times.map(t => ({ timestamp: new Date(t) })), new Date(T0.getTime() + m * 60_000))).toBe(false)
      }
    }
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

describe('showSparseWorkoutHrNote (#3839)', () => {
  const unmeasured = [{ hrMeasured: false }, { hrMeasured: false }]
  it('shows on a sparse workout', () => {
    expect(showSparseWorkoutHrNote(false, 9, [{ hrMeasured: true }])).toBe(true)
  })
  it('shows on a workout judged dense when no set had enough readings (3 to 5 minute spacing)', () => {
    expect(showSparseWorkoutHrNote(true, 13, unmeasured)).toBe(true)
    expect(showSparseWorkoutHrNote(null, 13, unmeasured)).toBe(true)
  })
  it('does not show when any set was measured, with no readings, with no sets, or on an older response', () => {
    expect(showSparseWorkoutHrNote(true, 3600, [{ hrMeasured: false }, { hrMeasured: true }])).toBe(false)
    expect(showSparseWorkoutHrNote(true, 0, unmeasured)).toBe(false)
    expect(showSparseWorkoutHrNote(true, 13, [])).toBe(false)
    expect(showSparseWorkoutHrNote(undefined, 13, [{}, {}])).toBe(false)
  })
})
