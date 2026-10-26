import { describe, it, expect } from 'vitest'
import {
  formatTemperatureDeviation,
  ouraTemperatureDeviationRow,
} from '@trainingai/shared/format/temperature-deviation'

describe('formatTemperatureDeviation', () => {
  it('signs and pads to two decimals', () => {
    expect(formatTemperatureDeviation(0.3)).toBe('+0.30 °C')
    expect(formatTemperatureDeviation(-0.2)).toBe('-0.20 °C')
  })
  it('reads a value that rounds to zero as unsigned zero', () => {
    expect(formatTemperatureDeviation(0)).toBe('0.00 °C')
    expect(formatTemperatureDeviation(-0.001)).toBe('0.00 °C')
  })
  it('returns null for a missing or non-finite value', () => {
    expect(formatTemperatureDeviation(null)).toBeNull()
    expect(formatTemperatureDeviation(undefined)).toBeNull()
    expect(formatTemperatureDeviation(NaN)).toBeNull()
  })
})

describe('ouraTemperatureDeviationRow', () => {
  it('draws the deviation with the Oura note when there is no mean', () => {
    expect(ouraTemperatureDeviationRow({ meanC: null, devC: 0.3 })).toEqual({
      label: 'Temperature vs your normal',
      value: '+0.30 °C',
      note: 'From Oura, against its own baseline',
    })
  })
  it('stays out of the way when a mean exists or there is no deviation', () => {
    expect(ouraTemperatureDeviationRow({ meanC: 34.1, devC: 0.3 })).toBeNull()
    expect(ouraTemperatureDeviationRow({ meanC: null, devC: null })).toBeNull()
    expect(ouraTemperatureDeviationRow(null)).toBeNull()
  })
})
