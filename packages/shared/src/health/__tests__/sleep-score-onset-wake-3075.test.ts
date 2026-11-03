import { describe, it, expect } from 'vitest'
import { computeSleepScore, sleepScoreBaselines, SLEEP_SCHEDULE_MIN_NIGHTS } from '../sleep-score'
import { aggregateNight, groupSleepPeriods } from '../sleep-night'
import type { SleepSession } from '../../types/body'

// #3075 stage 3: on an Oura Cloud night with a hypnogram, the timing and schedule terms read when sleep
// began and ended. The bed window (`sleepStart`/`sleepEnd`) is never changed. Brisbane is UTC+10 all year.
const TZ = 'Australia/Brisbane'
const bne = (day: number, hour: number, min = 0) => new Date(Date.UTC(2026, 9, day, hour - 10, min))

const night = (day: number, over: Partial<SleepSession> = {}): SleepSession => ({
  id: `n${day}`, userId: 'u1', date: `2026-10-${String(day).padStart(2, '0')}`,
  // In bed 21:00 to 08:00 (midpoint 02:30); asleep 23:00 to 07:00 (midpoint 03:00, the ideal).
  sleepStart: bne(day - 1, 21), sleepEnd: bne(day, 8), createdAt: bne(day, 9),
  durationHours: 8, efficiency: 90, deepSleepHours: 1.3, remSleepHours: 1.9, awakHours: 0.4, onsetLatencySec: 720,
  ...over,
}) as SleepSession

const timing = (s: SleepSession) => ({ score: computeSleepScore(s, TZ)!.components.timing })

describe('the timing term reads when sleep began and ended (#3075 stage 3)', () => {
  it('an Oura Cloud night with an onset and wake is timed from them, not the bed window', () => {
    const window = night(20)
    const real = night(20, { onsetAt: bne(19, 23), finalWakeAt: bne(20, 7) })
    expect(timing(real).score).toBeGreaterThan(timing(window).score) // 03:00 midpoint beats 02:30
    expect(timing(real).score).toBe(timing(night(20, { sleepStart: bne(19, 23), sleepEnd: bne(20, 7) })).score)
  })

  it('a night without them (a ring night, or no usable hypnogram) is exactly what it was', () => {
    const plain = night(20)
    expect(computeSleepScore(plain, TZ)).toEqual(computeSleepScore({ ...plain, onsetAt: undefined, finalWakeAt: undefined }, TZ))
  })

  it('an onset alone, or a wake alone, replaces only its own side', () => {
    const onsetOnly = night(20, { onsetAt: bne(19, 23) })
    expect(timing(onsetOnly).score).toBe(timing(night(20, { sleepStart: bne(19, 23) })).score)
  })
})

describe('the schedule term and the habitual hours read them too', () => {
  const prior = (withShape: boolean) => Array.from({ length: SLEEP_SCHEDULE_MIN_NIGHTS }, (_, i) =>
    night(i + 1, withShape ? { onsetAt: bne(i, 23), finalWakeAt: bne(i + 1, 7) } : {}))

  it('habitual bed and wake hours come from the real onset and wake where the nights have them', () => {
    const window = sleepScoreBaselines(prior(false), TZ)
    expect(window.habitualBedHour).toBeCloseTo(21, 6)
    expect(window.habitualWakeHour).toBeCloseTo(8, 6)
    const real = sleepScoreBaselines(prior(true), TZ)
    expect(real.habitualBedHour).toBeCloseTo(23, 6)
    expect(real.habitualWakeHour).toBeCloseTo(7, 6)
  })

  it('a night that matches the habit scores the schedule term in full', () => {
    const baselines = sleepScoreBaselines(prior(true), TZ)
    const real = night(20, { onsetAt: bne(19, 23), finalWakeAt: bne(20, 7) })
    const schedule = (s: SleepSession) => ({ score: computeSleepScore(s, TZ, baselines)!.components.schedule })
    expect(schedule(real).score).toBe(100)
    // Lying awake until 01:00 is a late night against the 23:00 habit; the bed window (21:00) hides it.
    expect(schedule(night(20, { onsetAt: bne(20, 1), finalWakeAt: bne(20, 7) })).score).toBeLessThan(100)
    expect(schedule(night(20)).score).toBe(100)
  })
})

describe('a fragmented night keeps the real onset of its first window and wake of its last', () => {
  it('carries them through aggregateNight, and leaves the bed window the whole span', () => {
    const a = night(20, { id: 'a', sleepStart: bne(19, 21), sleepEnd: bne(20, 2), durationHours: 4.5, onsetAt: bne(19, 22), computedAwakenings: 1 })
    const b = night(20, { id: 'b', sleepStart: bne(20, 3), sleepEnd: bne(20, 8), durationHours: 4.5, finalWakeAt: bne(20, 7), computedAwakenings: 2 })
    const [period] = groupSleepPeriods([a, b], TZ).nights
    const merged = aggregateNight(period)
    expect(merged.sleepStart).toEqual(bne(19, 21))
    expect(merged.sleepEnd).toEqual(bne(20, 8))
    expect(merged.onsetAt).toEqual(bne(19, 22))
    expect(merged.finalWakeAt).toEqual(bne(20, 7))
    expect(merged.computedAwakenings).toBe(1 + 2 + 1) // the gap between the windows is a wake-up too
  })

  it('adds nothing to a night that has none', () => {
    const [period] = groupSleepPeriods([night(20, { id: 'a', sleepEnd: bne(20, 2), durationHours: 4.5 }), night(20, { id: 'b', sleepStart: bne(20, 3), durationHours: 4.5 })], TZ).nights
    expect(Object.keys(aggregateNight(period))).not.toContain('onsetAt')
  })
})
