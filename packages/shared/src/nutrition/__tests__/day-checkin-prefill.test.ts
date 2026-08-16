import { describe, it, expect } from 'vitest'
import { prefillEveningScales } from '../day-checkin-prefill'

describe('prefillEveningScales', () => {
  it('maps Body Battery label to physical tiredness (Drained→5, Charged→1)', () => {
    expect(prefillEveningScales({ batteryLabel: 'Drained' }).physicalTiredness).toBe(5)
    expect(prefillEveningScales({ batteryLabel: 'Charged' }).physicalTiredness).toBe(1)
    expect(prefillEveningScales({ batteryLabel: 'Good' }).physicalTiredness).toBe(2)
  })
  it('maps low steps to a high "barely moved" score', () => {
    expect(prefillEveningScales({ steps: 800 }).barelyMoved).toBe(5)
    expect(prefillEveningScales({ steps: 12000 }).barelyMoved).toBe(1)
  })
  it('infers late/heavy meal from last-meal minutes-before-bed', () => {
    expect(prefillEveningScales({ lastMealMinutesBeforeBed: 30 }).lateHeavyMeal).toBe(5)
    expect(prefillEveningScales({ lastMealMinutesBeforeBed: 300 }).lateHeavyMeal).toBe(1)
  })
  it('defaults everything to a neutral 3 with no signals', () => {
    const p = prefillEveningScales({})
    expect(p).toEqual({ physicalTiredness: 3, mentalDrain: 3, barelyMoved: 3, hydration: 3, lateHeavyMeal: 3 })
  })
})
