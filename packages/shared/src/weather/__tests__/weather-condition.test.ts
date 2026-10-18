import { describe, it, expect } from 'vitest'
import { weatherCondition } from '../weather-condition'

// Moved from lib/__tests__/open-meteo.test.ts with the table itself (#3041).
describe('weatherCondition', () => {
  it('maps code 0 to clear', () => {
    expect(weatherCondition(0)).toBe('clear')
  })

  it('maps codes 1-3 and unrecognised codes to cloudy', () => {
    expect(weatherCondition(1)).toBe('cloudy')
    expect(weatherCondition(2)).toBe('cloudy')
    expect(weatherCondition(3)).toBe('cloudy')
    expect(weatherCondition(4)).toBe('cloudy')
  })

  it('maps codes 45 and 48 to fog', () => {
    expect(weatherCondition(45)).toBe('fog')
    expect(weatherCondition(48)).toBe('fog')
  })

  it('maps drizzle, rain and rain-shower codes to rain', () => {
    expect(weatherCondition(51)).toBe('rain')
    expect(weatherCondition(63)).toBe('rain')
    expect(weatherCondition(67)).toBe('rain')
    expect(weatherCondition(80)).toBe('rain')
    expect(weatherCondition(82)).toBe('rain')
  })

  it('maps snow and snow-shower codes to snow', () => {
    expect(weatherCondition(71)).toBe('snow')
    expect(weatherCondition(77)).toBe('snow')
    expect(weatherCondition(85)).toBe('snow')
    expect(weatherCondition(86)).toBe('snow')
  })

  it('maps codes 95-99 to thunderstorm', () => {
    expect(weatherCondition(95)).toBe('thunderstorm')
    expect(weatherCondition(96)).toBe('thunderstorm')
    expect(weatherCondition(99)).toBe('thunderstorm')
  })
})
