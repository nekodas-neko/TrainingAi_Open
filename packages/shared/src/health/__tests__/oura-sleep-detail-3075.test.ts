import { describe, it, expect } from 'vitest'
import {
  overnightHrvFromSeries, overnightRecoveryIndexHoursFromSeries, RECOVERY_SERIES_MIN_SAMPLES,
  sleepShapeFromHypnogram, HYPNOGRAM_MIN_EPOCHS,
} from '../oura-sleep-detail'
import { summarizeSleepStages } from '../sleep-staging'
import type { SleepStage } from '../hypnogram'
import { computeRecoveryIndex } from '../recovery-index'
import { hrvMsFromSamples } from '../night-vitals'

// #3075 stage 1: the night's HRV is the median of Oura's 5-minute HRV series, the ring-era definition.
const series = (items: (number | null)[], interval = 300) => ({ interval, items, timestamp: '2026-10-17T22:30:00+10:00' })

describe('overnightHrvFromSeries', () => {
  it('is the median of the measured samples, not their mean', () => {
    // Mean 57.6, median 49: one high stretch moves Oura's average and not the median.
    expect(overnightHrvFromSeries(series([45, 47, 49, 51, 96]))).toBe(49)
  })

  it('takes the middle two of an even count and rounds to 0.1, as the ring-era headline does', () => {
    expect(overnightHrvFromSeries(series([48, 61]))).toBe(54.5)
    expect(overnightHrvFromSeries(series([41.23, 42.31, 50]))).toBe(42.3)
    expect(overnightHrvFromSeries(series([40, 41, 42, 43.333]))).toBe(41.5)
  })

  it('agrees with the ring-era function on the same samples', () => {
    const items = [52, 61, 38, 44, 70, 49, 55]
    const samples = items.map((value, i) => ({ ds: i * 3000, value }))
    expect(overnightHrvFromSeries(series(items))).toBe(hrvMsFromSamples(samples, []))
  })

  it('leaves out a slot Oura did not measure, and anything that is not a positive number', () => {
    expect(overnightHrvFromSeries(series([null, 50, null, 0, -3, Number.NaN, 60]))).toBe(55)
  })

  it('is null with no series or no measured sample, never zero', () => {
    expect(overnightHrvFromSeries(null)).toBeNull()
    expect(overnightHrvFromSeries(undefined)).toBeNull()
    expect(overnightHrvFromSeries(series([]))).toBeNull()
    expect(overnightHrvFromSeries(series([null, null]))).toBeNull()
    expect(overnightHrvFromSeries({ interval: 300, items: 'x' as unknown as number[] })).toBeNull()
  })

  it('does not depend on the interval', () => {
    expect(overnightHrvFromSeries(series([50, 60, 70], 0))).toBe(60)
    expect(overnightHrvFromSeries(series([50, 60, 70], 600))).toBe(60)
  })
})

// #3075 stage 2: recovery-index hours from the 5-minute heart-rate series. Brisbane is UTC+10 all year.
describe('overnightRecoveryIndexHoursFromSeries', () => {
  const SLEEP_START = new Date('2026-10-17T22:30:00+10:00')
  const SLEEP_END = new Date('2026-10-18T06:30:00+10:00') // 8 h = 96 five-minute slots
  const window = { sleepStart: SLEEP_START, sleepEnd: SLEEP_END }
  const hr = (items: (number | null)[]) => ({ interval: 300, items, timestamp: SLEEP_START.toISOString() })
  /** A night that falls from 70 to 50 bpm by 02:30 (slot 48), then drifts back up to 58 by waking. */
  const fullNight = () => Array.from({ length: 96 }, (_, i) => (i <= 48 ? 70 - (20 * i) / 48 : 50 + (8 * (i - 48)) / 47))

  it('gives the hours from the lowest point to waking for a full series', () => {
    // The minimum is at slot 48 = 02:30, four hours before the 06:30 wake.
    expect(overnightRecoveryIndexHoursFromSeries(hr(fullNight()), window)).toBeCloseTo(4, 5)
  })

  it('is exactly what the ring-era function gives for the same bins', () => {
    const items = fullNight()
    const hrSeries = items.map((bpm, i) => ({ timestamp: new Date(SLEEP_START.getTime() + i * 300_000), bpm }))
    expect(overnightRecoveryIndexHoursFromSeries(hr(items), window))
      .toBe(computeRecoveryIndex({ hrSeries, wakeTime: SLEEP_END })!.hoursToSettle)
  })

  it('leaves out slots Oura did not measure and keeps their place in time', () => {
    const items = fullNight().map((v, i) => (i % 5 === 3 ? null : v))
    expect(overnightRecoveryIndexHoursFromSeries(hr(items), window)).toBeCloseTo(4, 0)
  })

  it('is null with no series, no start time, or nothing measured', () => {
    expect(overnightRecoveryIndexHoursFromSeries(null, window)).toBeNull()
    expect(overnightRecoveryIndexHoursFromSeries({ interval: 300, items: fullNight() }, window)).toBeNull()
    expect(overnightRecoveryIndexHoursFromSeries(hr([]), window)).toBeNull()
    expect(overnightRecoveryIndexHoursFromSeries(hr(Array(96).fill(null)), window)).toBeNull()
  })

  it('refuses a short series: under an hour of samples says nothing about the night', () => {
    const items = fullNight()
    expect(overnightRecoveryIndexHoursFromSeries(hr(items.slice(0, RECOVERY_SERIES_MIN_SAMPLES - 1)), { ...window, sleepEnd: new Date(SLEEP_START.getTime() + 11 * 300_000) })).toBeNull()
    expect(overnightRecoveryIndexHoursFromSeries(hr(items.slice(0, RECOVERY_SERIES_MIN_SAMPLES)), { ...window, sleepEnd: new Date(SLEEP_START.getTime() + 12 * 300_000) })).not.toBeNull()
  })

  it('refuses a partial series: plenty of samples covering under half the night', () => {
    // 40 of 96 slots (42%): the ring came off at 01:50. The minimum of that stretch is not the night's.
    expect(overnightRecoveryIndexHoursFromSeries(hr(fullNight().slice(0, 40)), window)).toBeNull()
    // 48 of 96 slots is exactly half and is accepted.
    expect(overnightRecoveryIndexHoursFromSeries(hr(fullNight().slice(0, 48)), window)).not.toBeNull()
  })

  it('never goes negative when the lowest point is at or after waking', () => {
    const lateMin = Array.from({ length: 96 }, (_, i) => 80 - i * 0.2)
    expect(overnightRecoveryIndexHoursFromSeries(hr(lateMin), window)).toBeGreaterThanOrEqual(0)
  })
})

// #3075 stage 3: onset, final wake, awakenings and WASO from the 30-second hypnogram. Brisbane is UTC+10 all year;
// the bed window opens at 22:30 local, 12:30Z, and an epoch is 30 s.
describe('sleepShapeFromHypnogram', () => {
  const BED = '2026-10-17T22:30:00+10:00'
  // 10 awake epochs (5 min to fall asleep), light, an awake run of 2, deep, 1 awake, REM, 3 awake, light,
  // then 8 awake epochs before the bed window closes: 174 epochs, 87 minutes.
  const night = '4'.repeat(10) + '2'.repeat(60) + '44' + '1'.repeat(40) + '4' + '3'.repeat(30) + '444' + '2'.repeat(20) + '4'.repeat(8)
  const at = (epoch: number) => new Date(new Date(BED).getTime() + epoch * 30_000)

  it('dates onset and final wake at the first and last non-awake epoch, and counts what lies between', () => {
    const shape = sleepShapeFromHypnogram(night, BED)!
    expect(shape.sleepOnset).toEqual(at(10))            // 22:35, not the 22:30 bed window start
    expect(shape.finalWake).toEqual(at(166))            // the end of the last light epoch, 23:53, not the 23:57 window end
    expect(shape.awakenings).toBe(3)                    // runs of 2, 1 and 3; neither the latency nor the final wake-up
    expect(shape.wasoMin).toBe(3)                       // 6 awake epochs x 30 s
  })

  it('reads a bed-window start given as a Date or as text alike', () => {
    expect(sleepShapeFromHypnogram(night, new Date(BED))).toEqual(sleepShapeFromHypnogram(night, BED))
  })

  it('counts a single awake epoch as an awakening, as the ring-era rule has no minimum run', () => {
    const one = '2'.repeat(60) + '4' + '2'.repeat(60)
    expect(sleepShapeFromHypnogram(one, BED)).toMatchObject({ awakenings: 1, wasoMin: 0.5 })
  })

  it('a night with no awake epoch inside it has none, and onset and wake are the window\'s', () => {
    const shape = sleepShapeFromHypnogram('2'.repeat(HYPNOGRAM_MIN_EPOCHS), BED)!
    expect(shape).toMatchObject({ awakenings: 0, wasoMin: 0 })
    expect(shape.sleepOnset).toEqual(at(0))
    expect(shape.finalWake).toEqual(at(HYPNOGRAM_MIN_EPOCHS))
  })

  it('agrees with the ring-era rule on the same epochs', () => {
    const code: Record<string, SleepStage> = { '1': 'deep', '2': 'light', '3': 'rem', '4': 'awake' }
    const stages = [...night].map(c => code[c])
    const first = stages.findIndex(s => s !== 'awake')
    const last = stages.length - 1 - [...stages].reverse().findIndex(s => s !== 'awake')
    const ring = summarizeSleepStages(stages.slice(first, last + 1), 0.5)
    const shape = sleepShapeFromHypnogram(night, BED)!
    expect(shape.awakenings).toBe(ring.awakenings)
    expect(shape.wasoMin).toBe(ring.awakeMin)
    // The whole string, as the ring's rollup would stage it, counts the trailing wake-up as one more run.
    expect(summarizeSleepStages(stages, 0.5).awakenings).toBe(shape.awakenings + 1)
  })

  it('is null for a missing, short, all-awake or malformed string', () => {
    expect(sleepShapeFromHypnogram(null, BED)).toBeNull()
    expect(sleepShapeFromHypnogram(undefined, BED)).toBeNull()
    expect(sleepShapeFromHypnogram('', BED)).toBeNull()
    expect(sleepShapeFromHypnogram('2'.repeat(HYPNOGRAM_MIN_EPOCHS - 1), BED)).toBeNull() // under an hour
    expect(sleepShapeFromHypnogram('4'.repeat(300), BED)).toBeNull()                     // no onset to find
    expect(sleepShapeFromHypnogram('2'.repeat(HYPNOGRAM_MIN_EPOCHS) + '9', BED)).toBeNull() // a code outside 1-4
    expect(sleepShapeFromHypnogram(night, null)).toBeNull()
    expect(sleepShapeFromHypnogram(night, 'not a date')).toBeNull()
  })
})
