/**
 * #3779 — what counts as an active minute on the walking plan, one test per counting rule of the
 * owner's signed proposal. Every instant is built from one fixed origin on both sides, so nothing
 * here depends on the clock.
 */
import { describe, it, expect } from 'vitest'
import {
  activeMinutesForActivity, averageSpeedKmh, dayActiveMinutes, MODERATE_CADENCE_SPM,
  type WalkingActivityInput,
} from '../walking-minutes'

const T0 = Date.UTC(2026, 10, 2, 2, 0, 0) // midday in Brisbane; only differences matter
const MIN = 60_000
const FLOOR = 110

const walk = (over: Partial<WalkingActivityInput> = {}): WalkingActivityInput => ({
  id: 'a1', activityType: 'walk', durationMin: 30, distanceKm: null, cadenceSpm: null, cadenceSeries: null,
  window: { fromMs: T0, toMs: T0 + 30 * MIN }, ...over,
})
/** A reading every `everySec` seconds across [fromMin, toMin], at `bpm`. */
const series = (fromMin: number, toMin: number, everySec: number, bpm: number) => {
  const out: { timestamp: number; bpm: number }[] = []
  for (let t = T0 + fromMin * MIN; t <= T0 + toMin * MIN; t += everySec * 1000) out.push({ timestamp: t, bpm })
  return out
}

describe('rule 1 — dense heart rate (readings no more than 2 minutes apart): unchanged', () => {
  it('counts the minutes at or above 40% of reserve', () => {
    const r = activeMinutesForActivity(walk(), series(0, 30, 60, 120), FLOOR)
    expect(r.minutes).toBe(30)
    expect(r.basis).toBe('heart_rate')
    expect(r.bySource.heartRate).toBe(30)
  })
  it('counts nothing below the floor, even when cadence says brisk', () => {
    const r = activeMinutesForActivity(walk({ cadenceSpm: 120 }), series(0, 30, 60, 100), FLOOR)
    expect(r.minutes).toBe(0)
    expect(r.basis).toBe('heart_rate')
  })
  it('a reading exactly at the floor counts', () => {
    expect(activeMinutesForActivity(walk(), series(0, 30, 60, FLOOR), FLOOR).minutes).toBe(30)
  })
  it('two minutes apart is dense; a little more is thin', () => {
    expect(activeMinutesForActivity(walk(), series(0, 30, 120, 120), FLOOR).basis).toBe('heart_rate')
    expect(activeMinutesForActivity(walk(), series(0, 30, 121, 120), FLOOR).basis).toBe('estimated')
  })
  it('counts dense heart rate in any activity, as the heart-health rule did', () => {
    expect(activeMinutesForActivity(walk({ activityType: 'cycle' }), series(0, 30, 60, 130), FLOOR).minutes).toBe(30)
  })
})

describe('rule 2 — thin heart rate, inside a walk, treadmill session, hike or run', () => {
  const thin = series(0, 30, 300, 130) // a reading every five minutes, as Oura Cloud sends

  it('a minute counts when the recording\'s cadence is 100 steps a minute or more', () => {
    const bins = Array.from({ length: 180 }, (_, i) => ({ tSec: i * 10, spm: i < 90 ? 112 : 92 }))
    const r = activeMinutesForActivity(walk({ cadenceSeries: bins }), thin, FLOOR)
    expect(r.minutes).toBe(15)
    expect(r.basis).toBe('cadence')
  })
  it('exactly 100 counts; 99 does not', () => {
    const at = (spm: number) => Array.from({ length: 180 }, (_, i) => ({ tSec: i * 10, spm }))
    expect(activeMinutesForActivity(walk({ cadenceSeries: at(MODERATE_CADENCE_SPM) }), [], FLOOR).minutes).toBe(30)
    expect(activeMinutesForActivity(walk({ cadenceSeries: at(MODERATE_CADENCE_SPM - 1) }), [], FLOOR).minutes).toBe(0)
  })
  it('a recording with only its average cadence is judged by that average', () => {
    expect(activeMinutesForActivity(walk({ cadenceSpm: 108 }), thin, FLOOR)).toMatchObject({ minutes: 30, basis: 'cadence' })
    expect(activeMinutesForActivity(walk({ cadenceSpm: 95 }), thin, FLOOR)).toMatchObject({ minutes: 0, basis: 'cadence' })
  })
  it('with no cadence, when the average speed is 4.8 km/h or more, from distance and duration', () => {
    expect(averageSpeedKmh(2.5, 30)).toBe(5)
    expect(activeMinutesForActivity(walk({ activityType: 'treadmill', distanceKm: 2.5 }), thin, FLOOR)).toMatchObject({ minutes: 30, basis: 'speed' })
    expect(activeMinutesForActivity(walk({ activityType: 'treadmill', distanceKm: 2.4 }), thin, FLOOR)).toMatchObject({ minutes: 30, basis: 'speed' }) // 4.8 exactly
    expect(activeMinutesForActivity(walk({ activityType: 'treadmill', distanceKm: 2.0 }), thin, FLOOR)).toMatchObject({ minutes: 0, basis: 'speed' }) // 4.0
  })
  it('with neither, half its duration, marked estimated', () => {
    expect(activeMinutesForActivity(walk({ activityType: 'hike', durationMin: 40, window: { fromMs: T0, toMs: T0 + 40 * MIN } }), thin, FLOOR))
      .toMatchObject({ minutes: 20, basis: 'estimated', bySource: { estimated: 20 } })
  })
  it('a logged walk with no start time is all thin, so it still counts', () => {
    expect(activeMinutesForActivity(walk({ window: null, activityType: 'treadmill', distanceKm: 3, durationMin: 36 }), [], FLOOR))
      .toMatchObject({ minutes: 36, basis: 'speed' })
    expect(activeMinutesForActivity(walk({ window: null, durationMin: 30 }), [], FLOOR)).toMatchObject({ minutes: 15, basis: 'estimated' })
  })
  it('does not apply outside a foot activity: thin heart rate in a ride counts nothing', () => {
    expect(activeMinutesForActivity(walk({ activityType: 'cycle', distanceKm: 15 }), thin, FLOOR)).toMatchObject({ minutes: 0, basis: null })
  })
  it('a walk that is dense for its first half and thin after uses each rule where it applies', () => {
    const hr = [...series(0, 15, 60, 125), ...series(20, 30, 600, 125)]
    const r = activeMinutesForActivity(walk({ distanceKm: 2.6 }), hr, FLOOR) // 5.2 km/h
    expect(r.bySource.heartRate).toBe(15)
    expect(r.bySource.speed).toBe(15)
    expect(r.minutes).toBe(30)
  })
  it('an implausible cadence bin is no cadence, and falls to speed', () => {
    const bins = Array.from({ length: 180 }, (_, i) => ({ tSec: i * 10, spm: 400 }))
    expect(activeMinutesForActivity(walk({ cadenceSeries: bins, distanceKm: 2.5 }), [], FLOOR).basis).toBe('speed')
  })
})

describe('rule 3 and 4 — the day', () => {
  it('sums its activities, credits the one with the most minutes, and says which rule counted most', () => {
    const a = activeMinutesForActivity(walk({ id: 'a', cadenceSpm: 110 }), [], FLOOR) // 30 cadence
    const b = activeMinutesForActivity(walk({ id: 'b', window: null, durationMin: 20 }), [], FLOOR) // 10 estimated
    expect(dayActiveMinutes([a, b])).toEqual({
      minutes: 40, basis: 'cadence', creditedId: 'a', bySource: { heartRate: 0, cadence: 30, speed: 0, estimated: 10 },
    })
  })
  it('a day with no activity has no active minutes, whatever its steps (rule 3)', () => {
    expect(dayActiveMinutes([])).toEqual({ minutes: 0, basis: null, creditedId: null, bySource: { heartRate: 0, cadence: 0, speed: 0, estimated: 0 } })
  })
})
