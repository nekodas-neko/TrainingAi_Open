import { describe, it, expect } from 'vitest'
import { computeDayPhase } from '../background/day-phase'
import { PALETTES } from '../background/palettes'

const sunrise = new Date('2026-06-11T06:32:00')
const sunset = new Date('2026-06-11T17:08:00')

describe('computeDayPhase', () => {
  it('returns the deep night palette exactly at solar midnight', () => {
    const solarMidnight = new Date('2026-06-10T23:50:00')
    const result = computeDayPhase(solarMidnight, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.deepNight.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.deepNight.skyBottom)
    expect(result.celestialColor).toEqual(PALETTES.deepNight.celestialColor)
    expect(result.celestialGlow).toEqual(PALETTES.deepNight.celestialGlow)
    expect(result.starOpacity).toBe(PALETTES.deepNight.starOpacity)
  })

  it('returns the dawn palette during the dawn window', () => {
    const duringDawn = new Date('2026-06-11T06:00:00')
    const result = computeDayPhase(duringDawn, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.dawn.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.dawn.skyBottom)
    expect(result.starOpacity).toBe(0)
  })

  it('returns the day palette and is marked as day at solar noon', () => {
    const solarNoon = new Date('2026-06-11T11:50:00')
    const result = computeDayPhase(solarNoon, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.day.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.day.skyBottom)
    expect(result.isDay).toBe(true)
    expect(result.celestialX).toBeCloseTo(50, 5)
    expect(result.celestialY).toBeCloseTo(20, 5)
  })

  it('returns the dusk palette during the dusk window', () => {
    const duringDusk = new Date('2026-06-11T17:30:00')
    const result = computeDayPhase(duringDusk, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.dusk.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.dusk.skyBottom)
    expect(result.isDay).toBe(false)
  })

  it('linearly interpolates between dawn and day in the gap between them', () => {
    // Halfway between sunrise (06:32, dawn) and sunrise+90min (08:02, day) -> 07:17
    const midGap = new Date('2026-06-11T07:17:00')
    const result = computeDayPhase(midGap, sunrise, sunset)

    expect(result.skyTop[0]).toBeCloseTo((PALETTES.dawn.skyTop[0] + PALETTES.day.skyTop[0]) / 2, 5)
    expect(result.skyTop[1]).toBeCloseTo((PALETTES.dawn.skyTop[1] + PALETTES.day.skyTop[1]) / 2, 5)
    expect(result.skyTop[2]).toBeCloseTo((PALETTES.dawn.skyTop[2] + PALETTES.day.skyTop[2]) / 2, 5)
  })

  it('places the sun low at sunrise and traces an arc to sunset', () => {
    const atSunrise = computeDayPhase(sunrise, sunrise, sunset)
    expect(atSunrise.isDay).toBe(true)
    expect(atSunrise.celestialX).toBeCloseTo(0, 5)
    expect(atSunrise.celestialY).toBeCloseTo(85, 5)

    const atSunset = computeDayPhase(sunset, sunrise, sunset)
    expect(atSunset.isDay).toBe(true)
    expect(atSunset.celestialX).toBeCloseTo(100, 5)
    expect(atSunset.celestialY).toBeCloseTo(85, 5)
  })

  it('places the moon at its peak at solar midnight', () => {
    const solarMidnight = new Date('2026-06-10T23:50:00')
    const result = computeDayPhase(solarMidnight, sunrise, sunset)

    expect(result.isDay).toBe(false)
    expect(result.celestialX).toBeCloseTo(50, 5)
    expect(result.celestialY).toBeCloseTo(20, 5)
  })

  it('reaches deep night within 2 hours of sunset, not gradually until solar midnight', () => {
    // Sunset is 17:08, so 2 hours later is 19:08
    const twoHoursAfterSunset = new Date('2026-06-11T19:08:00')
    const result = computeDayPhase(twoHoursAfterSunset, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.deepNight.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.deepNight.skyBottom)
    expect(result.starOpacity).toBe(PALETTES.deepNight.starOpacity)
  })

  it('stays at deep night in the evening (e.g. 8:29pm), well before solar midnight', () => {
    const eveningCheckIn = new Date('2026-06-11T20:29:00')
    const result = computeDayPhase(eveningCheckIn, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.deepNight.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.deepNight.skyBottom)
  })

  it('stays at deep night until 2 hours before sunrise', () => {
    // Sunrise is 06:32, so 2 hours before is 04:32
    const twoHoursBeforeSunrise = new Date('2026-06-11T04:32:00')
    const result = computeDayPhase(twoHoursBeforeSunrise, sunrise, sunset)

    expect(result.skyTop).toEqual(PALETTES.deepNight.skyTop)
    expect(result.skyBottom).toEqual(PALETTES.deepNight.skyBottom)
  })
})
