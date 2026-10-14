import { describe, it, expect } from 'vitest'
import { calibrationProgress } from '../calibration-progress'
import { MIN_LOGGED_DAYS } from '../adaptive-tdee'

describe('calibrationProgress', () => {
  it('counts the days still needed against the calibration minimum', () => {
    const p = calibrationProgress(3, false)
    expect(p?.remaining).toBe(MIN_LOGGED_DAYS - 3)
    expect(p?.count).toBe(`3 of ${MIN_LOGGED_DAYS}`)
    expect(p?.detail).toBe(`days marked · ${MIN_LOGGED_DAYS - 3} more days to calibrate your maintenance`)
  })

  it('says "1 more day", not "1 more days"', () => {
    expect(calibrationProgress(9, false, 10)?.detail).toBe('days marked · 1 more day to calibrate your maintenance')
  })

  it('never counts below zero', () => {
    expect(calibrationProgress(14, false, 10)?.remaining).toBe(0)
  })

  it('switches to the calibrated wording, singular for one day', () => {
    expect(calibrationProgress(12, true)?.detail).toBe('days marked · your maintenance is calibrated from them')
    expect(calibrationProgress(1, true)?.detail).toBe('day marked · your maintenance is calibrated from them')
  })

  it('returns nothing when there is no estimate to calibrate', () => {
    expect(calibrationProgress(null, false)).toBeNull()
  })
})
