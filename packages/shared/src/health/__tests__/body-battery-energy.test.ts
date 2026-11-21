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
  it('shows the current level with the morning mark and how far it has fallen', () => {
    const hero = energyHero(battery())
    if (!hero.hasData) throw new Error('expected data')
    expect(hero.level).toBe(46)
    expect(hero.morning).toBe(76)
    expect(hero.drained).toBe(30)
    expect(hero.label).toBe('Low')
    expect(hero.sub).toBe('woke at 76 · drained 30')
    expect(hero.origin).toBe('set from sleep')
  })

  it('rises with a recharge, not held at the day\'s low', () => {
    const hero = energyHero(battery({ current: 58, series: [{ v: 76 }, { v: 40 }, { v: 58 }] }))
    if (!hero.hasData) throw new Error('expected data')
    expect(hero.level).toBe(58)
    expect(hero.drained).toBe(18)
    expect(hero.label).toBe('Good')
    expect(hero.sub).toBe('woke at 76 · drained 18')
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

  describe('before the ring\'s first upload (#3502)', () => {
    const waiting = (over: Partial<BodyBatteryEnergyInput> = {}) =>
      battery({ hasData: false, current: 0, series: [], ...over })

    it('keeps the old "no data" result for every reader that did not opt in', () => {
      expect(energyHero(waiting())).toEqual({ hasData: false })
      expect(energyHero(waiting(), {})).toEqual({ hasData: false })
      expect(energyHero(waiting(), { waitingForRing: false })).toEqual({ hasData: false })
    })

    it('shows the morning level, its label and "woke at N" when opted in', () => {
      const hero = energyHero(waiting({ anchor: 76 }), { waitingForRing: true })
      if (!hero.hasData) throw new Error('expected the morning level')
      expect(hero.waiting).toBe(true)
      expect(hero.level).toBe(76)
      expect(hero.morning).toBe(76)
      expect(hero.drained).toBe(0)
      expect(hero.label).toBe('Charged')
      expect(hero.sub).toBe('woke at 76')
      expect(hero.origin).toBe('set from sleep')
    })

    it('says nothing is known when there is no payload or only the fallback anchor', () => {
      expect(energyHero(null, { waitingForRing: true })).toEqual({ hasData: false })
      expect(energyHero(undefined, { waitingForRing: true })).toEqual({ hasData: false })
      expect(
        energyHero(waiting({ anchorSource: 'default' }), { waitingForRing: true }),
      ).toEqual({ hasData: false })
      expect(
        energyHero(waiting({ anchor: Number.NaN }), { waitingForRing: true }),
      ).toEqual({ hasData: false })
    })

    it('is not waiting once a reading has arrived, whether or not the caller opted in', () => {
      for (const options of [undefined, { waitingForRing: true }]) {
        const hero = energyHero(battery(), options)
        if (!hero.hasData) throw new Error('expected data')
        expect(hero.waiting).toBe(false)
        expect(hero.level).toBe(46)
        expect(hero.sub).toBe('woke at 76 · drained 30')
      }
    })
  })
})
