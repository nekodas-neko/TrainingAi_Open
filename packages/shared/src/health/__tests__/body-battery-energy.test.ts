import { describe, it, expect } from 'vitest'
import { energyHero, type BodyBatteryEnergyInput } from '../body-battery-energy'

const battery = (over: Partial<BodyBatteryEnergyInput> = {}): BodyBatteryEnergyInput => ({
  hasData: true,
  current: 46,
  anchor: 76,
  anchorSource: 'sleep',
  anchorProvisional: false,
  series: [{ v: 76 }, { v: 60 }, { v: 46 }],
  ...over,
})

describe('energyHero', () => {
  it("shows the day's low with the morning mark and how far it has fallen", () => {
    const hero = energyHero(battery())
    if (!hero.hasData) throw new Error('expected data')
    expect(hero.level).toBe(46)
    expect(hero.morning).toBe(76)
    expect(hero.drained).toBe(30)
    expect(hero.label).toBe('Low')
    expect(hero.sub).toBe('woke at 76 · drained 30')
    expect(hero.origin).toBe('set from sleep')
  })

  it("never rises: a recharge leaves the number at the day's low", () => {
    const hero = energyHero(battery({ current: 58, series: [{ v: 76 }, { v: 40 }, { v: 58 }] }))
    if (!hero.hasData) throw new Error('expected data')
    expect(hero.level).toBe(40)
    expect(hero.label).toBe('Low')
  })

  it('never sits above the morning mark', () => {
    const hero = energyHero(battery({ anchor: 70, current: 82, series: [{ v: 82 }] }))
    if (!hero.hasData) throw new Error('expected data')
    expect(hero.level).toBe(70)
    expect(hero.drained).toBe(0)
    expect(hero.sub).toBe('woke at 70')
  })

  it('takes the band from the number on screen, at its edges', () => {
    const label = (current: number) => {
      const hero = energyHero(battery({ anchor: 100, current, series: [] }))
      return hero.hasData ? hero.label : null
    }
    expect(label(75)).toBe('Charged')
    expect(label(74)).toBe('Good')
    expect(label(50)).toBe('Good')
    expect(label(49)).toBe('Low')
    expect(label(25)).toBe('Low')
    expect(label(24)).toBe('Drained')
  })

  it('says when the morning figure is provisional, and draws nothing without data', () => {
    const hero = energyHero(battery({ anchorSource: 'readiness', anchorProvisional: true }))
    if (!hero.hasData) throw new Error('expected data')
    expect(hero.origin).toMatch(/^set from readiness · provisional/)
    expect(energyHero(battery({ hasData: false }))).toEqual({ hasData: false })
    expect(energyHero(null)).toEqual({ hasData: false })
  })

  it('flags limited data', () => {
    const hero = energyHero(battery({ confidence: { sufficient: false } }))
    if (!hero.hasData) throw new Error('expected data')
    expect(hero.limited).toBe(true)
  })
})
