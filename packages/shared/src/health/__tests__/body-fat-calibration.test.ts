import { describe, it, expect } from 'vitest'
import {
  deriveBodyFatCalibration,
  correctBodyFatPct,
  pairScansWithReadings,
  PAIR_WINDOW_DAYS,
  type CalibrationPair,
} from '../body-fat-calibration'

const pair = (over: Partial<CalibrationPair> = {}): CalibrationPair => ({
  scannedOn: '2026-08-27',
  scaleDate: '2026-08-27',
  referencePct: 28.5,
  measuredPct: 25.3,
  ...over,
})

describe('deriveBodyFatCalibration', () => {
  // The owner's real 2026-08-27 pair. The number is asserted so a change to the derivation shows up
  // as a change to this measurement, not as a silently different correction.
  it('derives the measured offset from the real pair', () => {
    const cal = deriveBodyFatCalibration([pair()], 'scale_ble')
    expect(cal).not.toBeNull()
    expect(cal!.offsetPct).toBe(3.2)
    expect(cal!.source).toBe('scale_ble')
    expect(cal!.pairs).toHaveLength(1)
  })

  it('averages across pairs rather than taking the newest', () => {
    const cal = deriveBodyFatCalibration(
      [pair(), pair({ scannedOn: '2027-02-01', scaleDate: '2027-02-01', referencePct: 26, measuredPct: 24 })],
      'scale_ble',
    )
    expect(cal!.offsetPct).toBe(2.6)
  })

  // A calibration with no pairs must be null, never a zero offset — the caller has to be able to
  // tell "not corrected" from "corrected by 0.0", because the UI says different things.
  it('returns null rather than a zero offset when there are no pairs', () => {
    expect(deriveBodyFatCalibration([], 'scale_ble')).toBeNull()
  })

  it('drops a pair with a non-finite or non-positive side, and nulls out if none survive', () => {
    expect(deriveBodyFatCalibration([pair({ measuredPct: 0 })], 'scale_ble')).toBeNull()
    expect(deriveBodyFatCalibration([pair({ referencePct: NaN })], 'scale_ble')).toBeNull()
    const mixed = deriveBodyFatCalibration([pair({ measuredPct: 0 }), pair()], 'scale_ble')
    expect(mixed!.pairs).toHaveLength(1)
    expect(mixed!.offsetPct).toBe(3.2)
  })
})

describe('correctBodyFatPct', () => {
  const cal = deriveBodyFatCalibration([pair()], 'scale_ble')!

  it('corrects a reading from the calibrated instrument', () => {
    const out = correctBodyFatPct(25.2, 'scale_ble', cal)
    expect(out).toEqual({ pct: 28.4, rawPct: 25.2, corrected: true })
  })

  // The property that makes the offset the right shape at n=1: re-correcting the very reading the
  // calibration was derived from lands exactly on the DEXA. A form that missed its own pair would
  // be fitting something other than the measurement.
  it('returns the reference value for the reading it was derived from', () => {
    expect(correctBodyFatPct(25.3, 'scale_ble', cal)!.pct).toBe(28.5)
  })

  // The owner's own refinement: the filter is per measurement system. A different scale is a
  // different bias, and applying this one to it would be worse than applying none.
  it('leaves a reading from any other instrument alone', () => {
    expect(correctBodyFatPct(22.8, 'health_connect', cal)).toEqual({ pct: 22.8, rawPct: 22.8, corrected: false })
  })

  // Two-thirds of the owner's history predates provenance being recorded. Those rows are PROBABLY
  // the same scale, and "probably" is how a calibration reaches an instrument it was never measured
  // on. An unknown instrument is not this one.
  it('leaves a reading with no recorded source alone', () => {
    expect(correctBodyFatPct(23.5, null, cal)).toEqual({ pct: 23.5, rawPct: 23.5, corrected: false })
  })

  it('leaves everything alone when there is no calibration', () => {
    expect(correctBodyFatPct(25.2, 'scale_ble', null)).toEqual({ pct: 25.2, rawPct: 25.2, corrected: false })
  })

  // A correction that produces an implausible number is a broken calibration, not a licence to
  // store an implausible number.
  it('refuses a correction that leaves the plausible band', () => {
    const huge = deriveBodyFatCalibration([pair({ referencePct: 59, measuredPct: 20 })], 'scale_ble')!
    expect(correctBodyFatPct(58, 'scale_ble', huge)).toEqual({ pct: 58, rawPct: 58, corrected: false })
  })

  it('reports corrected even when the offset rounds to zero', () => {
    const flat = deriveBodyFatCalibration([pair({ referencePct: 25.3, measuredPct: 25.3 })], 'scale_ble')!
    expect(flat.offsetPct).toBe(0)
    expect(correctBodyFatPct(25.2, 'scale_ble', flat)).toEqual({ pct: 25.2, rawPct: 25.2, corrected: true })
  })

  it('returns null for a missing reading rather than inventing one', () => {
    expect(correctBodyFatPct(null, 'scale_ble', cal)).toBeNull()
    expect(correctBodyFatPct(undefined, 'scale_ble', cal)).toBeNull()
  })
})

describe('pairScansWithReadings', () => {
  const scan = { scannedOn: '2026-08-27', pctFat: 28.5 }

  it('pairs a scan with the same-day reading', () => {
    const pairs = pairScansWithReadings([scan], [
      { date: '2026-08-27', bodyFatPct: 25.3, source: 'scale_ble' },
    ], 'scale_ble')
    expect(pairs).toEqual([{ scannedOn: '2026-08-27', scaleDate: '2026-08-27', referencePct: 28.5, measuredPct: 25.3 }])
  })

  it('takes the nearest reading in the window, not the first', () => {
    const pairs = pairScansWithReadings([scan], [
      { date: '2026-08-25', bodyFatPct: 25.2, source: 'scale_ble' },
      { date: '2026-08-26', bodyFatPct: 25.1, source: 'scale_ble' },
    ], 'scale_ble')
    expect(pairs[0].scaleDate).toBe('2026-08-26')
  })

  it('reaches to the window edge and no further', () => {
    const inside = pairScansWithReadings([scan], [
      { date: '2026-08-24', bodyFatPct: 25, source: 'scale_ble' },
    ], 'scale_ble')
    expect(inside).toHaveLength(1)
    expect(PAIR_WINDOW_DAYS).toBe(3)
    const outside = pairScansWithReadings([scan], [
      { date: '2026-08-23', bodyFatPct: 25, source: 'scale_ble' },
    ], 'scale_ble')
    expect(outside).toEqual([])
  })

  it('ignores readings from another instrument entirely', () => {
    const pairs = pairScansWithReadings([scan], [
      { date: '2026-08-27', bodyFatPct: 22.8, source: 'health_connect' },
      { date: '2026-08-27', bodyFatPct: 23.5, source: null },
    ], 'scale_ble')
    expect(pairs).toEqual([])
  })

  it('never pairs one reading with two scans', () => {
    const pairs = pairScansWithReadings(
      [scan, { scannedOn: '2026-08-28', pctFat: 28.4 }],
      [{ date: '2026-08-27', bodyFatPct: 25.3, source: 'scale_ble' }],
      'scale_ble',
    )
    expect(pairs).toHaveLength(1)
    expect(pairs[0].scannedOn).toBe('2026-08-27')
  })

  it('does not depend on input order', () => {
    const readings = [
      { date: '2026-08-26', bodyFatPct: 25.1, source: 'scale_ble' },
      { date: '2026-08-28', bodyFatPct: 25.5, source: 'scale_ble' },
    ]
    const forward = pairScansWithReadings([scan], readings, 'scale_ble')
    const reversed = pairScansWithReadings([scan], [...readings].reverse(), 'scale_ble')
    expect(forward).toEqual(reversed)
  })

  it('accepts the slash date form the client emits', () => {
    const pairs = pairScansWithReadings([{ scannedOn: '2026/08/27', pctFat: 28.5 }], [
      { date: '2026/08/26', bodyFatPct: 25.1, source: 'scale_ble' },
    ], 'scale_ble')
    expect(pairs).toHaveLength(1)
  })
})
