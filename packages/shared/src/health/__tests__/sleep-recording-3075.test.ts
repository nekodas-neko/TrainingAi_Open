import { describe, it, expect } from 'vitest'
import {
  restlessnessFromMovement, MOVEMENT_MIN_MEASURED_MIN, MOVEMENT_MIN_COVERAGE, type MovementLevel, type MovementSeries,
} from '../sleep-recording'
import { computeSleepScore, sleepScoreBaselines, restlessFractionOf, SLEEP_SCHEDULE_MIN_NIGHTS, SLEEP_HRV_BASELINE_MIN_NIGHTS } from '../sleep-score'
import { perDeviceNormal, rowsInNormalGroup } from '../per-device-normal'
import { isPartialNight, withoutPartialDuration } from '../partial-night'
import { aggregateNight, groupSleepPeriods } from '../sleep-night'
import type { SleepSession } from '../../types/body'

// #3075 stages 4 and 5, source-agnostic: every fixture here is a generic shape, with no device's field names.
const TZ = 'Australia/Brisbane'
const bne = (day: number, hour: number, min = 0) => new Date(Date.UTC(2026, 9, day, hour - 10, min))

/** A series of `epochs` epochs of `epochSec` from `startAt`, `restlessEvery`th epoch moving (0 = never). */
const series = (startAt: Date, epochs: number, epochSec: number, restlessEvery: number, level: MovementLevel = 1): MovementSeries => ({
  epochSec, startAt,
  levels: Array.from({ length: epochs }, (_, i) => (restlessEvery > 0 && i % restlessEvery === 0 ? level : 0)),
})

describe('restlessnessFromMovement (#3075 stage 4)', () => {
  const from = bne(19, 23)
  const to = bne(20, 7) // an 8-hour sleep window

  it('is the share of the measured sleep window spent moving, in minutes', () => {
    const r = restlessnessFromMovement(series(from, 960, 30, 4), { from, to })!
    expect(r.measuredMin).toBe(480)
    expect(r.restlessMin).toBe(120)
    expect(r.restlessFraction).toBeCloseTo(0.25, 9)
  })

  it('is the same share whatever the epoch length, so two devices land on one scale', () => {
    const thirty = restlessnessFromMovement(series(from, 960, 30, 4), { from, to })!
    const minute = restlessnessFromMovement(series(from, 480, 60, 4), { from, to })!
    expect(minute.restlessFraction).toBeCloseTo(thirty.restlessFraction, 9)
    expect(minute.restlessMin).toBe(thirty.restlessMin)
  })

  it('counts only epochs inside the sleep window, so lying awake before onset is not counted twice', () => {
    // An hour in bed before onset, every epoch moving; then the 8-hour window as before.
    const bed = bne(19, 22)
    const levels: (MovementLevel | null)[] = [...Array(120).fill(3), ...series(from, 960, 30, 4).levels]
    const r = restlessnessFromMovement({ epochSec: 30, startAt: bed, levels }, { from, to })!
    expect(r.restlessMin).toBe(120)
    expect(r.measuredMin).toBe(480)
  })

  it('treats an unmeasured epoch as unmeasured, not still', () => {
    const levels = series(from, 960, 30, 4).levels.map((l, i) => (i % 4 === 1 ? null : l))
    const r = restlessnessFromMovement({ epochSec: 30, startAt: from, levels }, { from, to })!
    expect(r.measuredMin).toBe(360)
    expect(r.restlessFraction).toBeCloseTo(120 / 360, 9)
  })

  it(`refuses a series under ${MOVEMENT_MIN_MEASURED_MIN} measured minutes, however much of a short window it covers`, () => {
    const shortTo = new Date(from.getTime() + 50 * 60_000)
    expect(restlessnessFromMovement(series(from, 100, 30, 4), { from, to: shortTo })).toBeNull()
  })

  it(`refuses a series covering under ${MOVEMENT_MIN_COVERAGE * 100}% of the window: a fragment is not the night`, () => {
    // Three measured hours of an eight-hour window.
    expect(restlessnessFromMovement(series(from, 360, 30, 4), { from, to })).toBeNull()
    expect(restlessnessFromMovement(series(from, 480, 30, 4), { from, to })).not.toBeNull()
  })

  it('refuses a missing series, a bad epoch length or an empty window', () => {
    expect(restlessnessFromMovement(null, { from, to })).toBeNull()
    expect(restlessnessFromMovement({ ...series(from, 960, 30, 4), epochSec: 0 }, { from, to })).toBeNull()
    expect(restlessnessFromMovement(series(from, 960, 30, 4), { from: to, to: from })).toBeNull()
  })
})

const night = (day: number, over: Partial<SleepSession> = {}): SleepSession => ({
  id: `n${day}`, userId: 'u1', date: `2026-10-${String(day).padStart(2, '0')}`,
  sleepStart: bne(day - 1, 23), sleepEnd: bne(day, 7), createdAt: bne(day, 9),
  durationHours: 7.6, efficiency: 90, deepSleepHours: 1.3, remSleepHours: 1.9, awakHours: 0.4, onsetLatencySec: 720,
  averageHrvMs: 50, avgHeartRate: 55, durationSource: 'source_a', hrvSource: 'source_a', avgHeartRateSource: 'source_a',
  ...over,
}) as SleepSession

describe('the Sleep Score restlessness term (#3075 stage 4)', () => {
  const restfulness = (s: SleepSession) => computeSleepScore(s, TZ)!.components.restfulness

  it('a night without a usable series scores exactly as before', () => {
    const plain = night(20)
    expect(computeSleepScore(plain, TZ)).toEqual(computeSleepScore({ ...plain, restlessMin: undefined, movementMeasuredMin: undefined }, TZ))
    expect(restlessFractionOf(plain)).toBeNull()
  })

  it('ordinary movement (up to a fifth of the window) costs nothing', () => {
    expect(restfulness(night(20, { restlessMin: 96, movementMeasuredMin: 480 }))).toBe(restfulness(night(20)))
  })

  it('a restless night loses restfulness, more the more it moved', () => {
    const calm = restfulness(night(20))
    const restless = restfulness(night(20, { restlessMin: 192, movementMeasuredMin: 480 })) // 40%
    const thrashing = restfulness(night(20, { restlessMin: 288, movementMeasuredMin: 480 })) // 60%
    expect(restless).toBe(calm - 8)
    expect(thrashing).toBe(calm - 18)
    expect(computeSleepScore(night(20, { restlessMin: 288, movementMeasuredMin: 480 }), TZ)!.score)
      .toBeLessThanOrEqual(computeSleepScore(night(20), TZ)!.score)
  })
})

describe('a recording its source says is incomplete is a partial night (#3075 stage 5)', () => {
  it('reads as partial through the one partial-night rule, with no Sleep Score of its own', () => {
    const cut = night(20, { recordingIncomplete: true })
    expect(isPartialNight(cut)).toBe(true)
    expect(computeSleepScore(cut, TZ)).toBeNull()
    // Its physiology stays; its duration and restlessness go, as for the owner's mark.
    const kept = withoutPartialDuration({ ...cut, restlessMin: 100, movementMeasuredMin: 400 })
    expect(kept.averageHrvMs).toBe(50)
    expect(kept.durationHours).toBeUndefined()
    expect(kept.restlessMin).toBeUndefined()
  })

  it('a complete recording, or one that does not say, is not partial', () => {
    expect(isPartialNight(night(20, { recordingIncomplete: false }))).toBe(false)
    expect(isPartialNight(night(20))).toBe(false)
  })

  it('a night of two windows is incomplete when either window is', () => {
    const a = night(20, { sleepStart: bne(19, 22), sleepEnd: bne(20, 1), durationHours: 3 })
    const b = night(20, { id: 'n20b', sleepStart: bne(20, 2), sleepEnd: bne(20, 7), durationHours: 5, recordingIncomplete: true })
    const [period] = groupSleepPeriods([a, b], TZ).nights
    expect(period.windows).toHaveLength(2)
    expect(isPartialNight(aggregateNight(period))).toBe(true)
  })
})

describe('reassembling a night keeps restlessness only when every window measured it', () => {
  const a = (over: Partial<SleepSession> = {}) => night(20, { sleepStart: bne(19, 22), sleepEnd: bne(20, 1), durationHours: 3, ...over })
  const b = (over: Partial<SleepSession> = {}) => night(20, { id: 'n20b', sleepStart: bne(20, 2), sleepEnd: bne(20, 7), durationHours: 5, ...over })
  const merged = (x: SleepSession, y: SleepSession) => aggregateNight(groupSleepPeriods([x, y], TZ).nights[0])

  it('sums the minutes when both windows have a series', () => {
    const m = merged(a({ restlessMin: 30, movementMeasuredMin: 180 }), b({ restlessMin: 60, movementMeasuredMin: 300 }))
    expect(m.restlessMin).toBe(90)
    expect(m.movementMeasuredMin).toBe(480)
  })

  it('has none when one window has none, rather than a fragment\'s share', () => {
    const m = merged(a({ restlessMin: 30, movementMeasuredMin: 180 }), b())
    expect(restlessFractionOf(m)).toBeNull()
  })
})

describe('normals keyed by (source, algorithm version) (#3075 stage 5)', () => {
  const reading = (i: number, value: number, algorithmVersion?: string | null, source = 'source_a') =>
    ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, value, source, algorithmVersion })

  it('a version change restarts the normal, and the previous version carries over', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => reading(i, 50, 'v1')),
      ...Array.from({ length: 2 }, (_, i) => reading(10 + i, 70, 'v2')),
    ]
    const n = perDeviceNormal(rows, { minNights: 5 })
    expect(n.nights).toBe(2)
    expect(n.value).toBeNull()
    expect(n.provisional).toBe(70)
    expect(n.carriedOver).toEqual({ source: 'source_a', nights: 10, value: 50 })
  })

  it('a reading with no version joins the newest version, so an unversioned history does not split', () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => reading(i, 50, null)),
      ...Array.from({ length: 3 }, (_, i) => reading(8 + i, 50, 'v2')),
    ]
    expect(perDeviceNormal(rows, { minNights: 5 }).nights).toBe(11)
  })

  it('a caller that passes no versions gets the per-source normal it had', () => {
    const rows = [reading(0, 40, undefined, 'source_b'), ...Array.from({ length: 6 }, (_, i) => reading(1 + i, 50))]
    expect(perDeviceNormal(rows, { minNights: 5 })).toMatchObject({ source: 'source_a', nights: 6, value: 50 })
  })

  it('rowsInNormalGroup picks the same group perDeviceNormal keys by', () => {
    const rows = [reading(0, 1, 'v1'), reading(1, 2, null), reading(2, 3, 'v2'), reading(3, 4, 'v2', 'source_b')]
    expect(rowsInNormalGroup(rows, r => r.source, r => r.algorithmVersion, { source: 'source_a', algorithmVersion: 'v2' }).map(r => r.value)).toEqual([2, 3])
    expect(rowsInNormalGroup(rows, r => r.source, r => r.algorithmVersion, { source: 'source_a' }).map(r => r.value)).toEqual([2, 3])
    expect(rowsInNormalGroup(rows, r => r.source, r => r.algorithmVersion, { source: 'source_a', algorithmVersion: 'v1' }).map(r => r.value)).toEqual([1])
  })

  it('the Sleep Score\'s HRV and schedule normals restart when the source changes its algorithm', () => {
    const n = Math.max(SLEEP_HRV_BASELINE_MIN_NIGHTS, SLEEP_SCHEDULE_MIN_NIGHTS)
    const priors = Array.from({ length: n }, (_, i) => night(i + 1, { sourceAlgorithmVersion: 'v1' }))
    const same = sleepScoreBaselines(priors, TZ, { durationSource: 'source_a', hrvSource: 'source_a', avgHeartRateSource: 'source_a', sourceAlgorithmVersion: 'v1' })
    expect(same.hrvBaselineMs).toBe(50)
    expect(same.habitualWakeHour).not.toBeNull()
    const changed = sleepScoreBaselines(priors, TZ, { durationSource: 'source_a', hrvSource: 'source_a', avgHeartRateSource: 'source_a', sourceAlgorithmVersion: 'v2' })
    expect(changed.hrvBaselineMs).toBeNull()
    expect(changed.habitualWakeHour).toBeNull()
    // A scored night that does not say joins the newest version its source sent.
    const unsaid = sleepScoreBaselines(priors, TZ, { durationSource: 'source_a', hrvSource: 'source_a', avgHeartRateSource: 'source_a' })
    expect(unsaid).toEqual(same)
  })
})
