import { describe, it, expect } from 'vitest'
import { isWithinDayWindow, DAY_START_HOUR, DAY_END_HOUR } from '@/lib/oura-ble/continuous-capture'

describe('continuous capture day window', () => {
  it('streams only inside the day window', () => {
    expect(isWithinDayWindow(DAY_START_HOUR)).toBe(true)
    expect(isWithinDayWindow(12)).toBe(true)
    expect(isWithinDayWindow(DAY_END_HOUR - 1)).toBe(true)
    expect(isWithinDayWindow(DAY_END_HOUR)).toBe(false)
    expect(isWithinDayWindow(23)).toBe(false)
    expect(isWithinDayWindow(0)).toBe(false)
    expect(isWithinDayWindow(DAY_START_HOUR - 1)).toBe(false)
  })
})
