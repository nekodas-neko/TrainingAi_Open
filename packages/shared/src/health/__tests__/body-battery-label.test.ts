import { describe, it, expect } from 'vitest'
import { bodyBatteryLabelFor } from '../body-battery-band'

describe('bodyBatteryLabelFor', () => {
  it('puts each tier edge in the higher tier', () => {
    expect(bodyBatteryLabelFor(100)).toBe('Charged')
    expect(bodyBatteryLabelFor(75)).toBe('Charged')
    expect(bodyBatteryLabelFor(74)).toBe('Good')
    expect(bodyBatteryLabelFor(50)).toBe('Good')
    expect(bodyBatteryLabelFor(49)).toBe('Low')
    expect(bodyBatteryLabelFor(25)).toBe('Low')
    expect(bodyBatteryLabelFor(24)).toBe('Drained')
    expect(bodyBatteryLabelFor(0)).toBe('Drained')
  })
})
