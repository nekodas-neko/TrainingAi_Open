import { describe, it, expect } from 'vitest'
import {
  LEVEL_THRESHOLDS,
  getBadgeTier,
  getLevelLabel,
  levelProgress,
} from '../achievement-display'

describe('levelProgress', () => {
  it('is the share of the way from this level to the next', () => {
    expect(levelProgress(175, 100, 250)).toBe(0.5)
  })
  it('stays within 0 and 1', () => {
    expect(levelProgress(50, 100, 250)).toBe(0)
    expect(levelProgress(900, 100, 250)).toBe(1)
  })
  it('reads the top level, which has nothing above it, as full', () => {
    expect(levelProgress(9000, 8000, 8000)).toBe(1)
  })
})

describe('level ladder', () => {
  it('has eleven rungs that only go up', () => {
    expect(LEVEL_THRESHOLDS).toHaveLength(11)
    expect(LEVEL_THRESHOLDS.every((x, i) => i === 0 || x > LEVEL_THRESHOLDS[i - 1])).toBe(true)
  })
  it('labels two levels to a band, and Legend above them', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(getLevelLabel)).toEqual([
      'Novice', 'Novice', 'Beginner', 'Beginner', 'Intermediate', 'Intermediate',
      'Advanced', 'Advanced', 'Elite', 'Elite', 'Legend',
    ])
  })
  it('puts a badge in a tier by its reward', () => {
    expect([49, 50, 199, 200].map(getBadgeTier)).toEqual(['bronze', 'silver', 'silver', 'gold'])
  })
})
