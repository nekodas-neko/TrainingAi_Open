import { describe, it, expect } from 'vitest'
import { calorieDayHitsGoal } from '@trainingai/shared/achievements-calc'

const TARGET = 2000

describe('calorieDayHitsGoal', () => {
  it('returns false when there is no target', () => {
    expect(calorieDayHitsGoal(1800, 0, null, null)).toBe(false)
  })

  describe('cutting (target weight below current)', () => {
    it('counts a day at or under target as a hit', () => {
      expect(calorieDayHitsGoal(1900, TARGET, 70, 80)).toBe(true)
      expect(calorieDayHitsGoal(2000, TARGET, 70, 80)).toBe(true)
    })
    it('counts exceeding target as a miss', () => {
      expect(calorieDayHitsGoal(2300, TARGET, 70, 80)).toBe(false)
    })
  })

  describe('bulking (target weight above current)', () => {
    it('counts meeting or exceeding target as a hit', () => {
      expect(calorieDayHitsGoal(2100, TARGET, 90, 80)).toBe(true)
      expect(calorieDayHitsGoal(2000, TARGET, 90, 80)).toBe(true)
    })
    it('counts under-eating as a miss', () => {
      expect(calorieDayHitsGoal(1700, TARGET, 90, 80)).toBe(false)
    })
  })

  describe('maintaining / unknown direction', () => {
    it('counts within ±10% either way as a hit', () => {
      expect(calorieDayHitsGoal(2100, TARGET, null, null)).toBe(true)
      expect(calorieDayHitsGoal(1850, TARGET, null, null)).toBe(true)
      expect(calorieDayHitsGoal(2000, TARGET, 80, 80)).toBe(true)
    })
    it('counts well outside the band as a miss', () => {
      expect(calorieDayHitsGoal(2500, TARGET, null, null)).toBe(false)
      expect(calorieDayHitsGoal(1500, TARGET, null, null)).toBe(false)
    })
    it('treats a sub-0.5kg target/current gap as maintain (band), not a cut/bulk', () => {
      expect(calorieDayHitsGoal(2150, TARGET, 80.2, 80)).toBe(true)
      expect(calorieDayHitsGoal(2500, TARGET, 80.2, 80)).toBe(false)
    })
  })
})
