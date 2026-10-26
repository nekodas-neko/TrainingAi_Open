import { describe, it, expect } from 'vitest'
import { calibrationProgress, markedDayNote } from '../calibration-progress'
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

  it('shows the server gap message, not "0 more days", once enough days are marked but the estimate declines', () => {
    const p = calibrationProgress(12, false, 10, 'Too many unlogged days in the window to calibrate')
    expect(p?.remaining).toBe(0)
    expect(p?.count).toBe('12')
    expect(p?.detail).toBe('days marked · Too many unlogged days in the window to calibrate')
    expect(calibrationProgress(12, false, 10)?.detail).toBe('days marked')
  })

  it('switches to the calibrated wording, singular for one day', () => {
    expect(calibrationProgress(12, true)?.detail).toBe('days marked · your maintenance is calibrated from them')
    expect(calibrationProgress(1, true)?.detail).toBe('day marked · your maintenance is calibrated from them')
  })

  it('returns nothing when there is no estimate to calibrate', () => {
    expect(calibrationProgress(null, false)).toBeNull()
  })
})

describe('markedDayNote', () => {
  it('says today counts from tomorrow, and a past day keeps the plain sentence', () => {
    expect(markedDayNote(true)).toBe('This day counts toward your maintenance estimate from tomorrow')
    expect(markedDayNote(false)).toBe('This day counts toward your maintenance estimate')
  })
})
