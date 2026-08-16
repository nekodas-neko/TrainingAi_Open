import { describe, it, expect } from 'vitest'
import { isLowerBodyMuscle, LOWER_BODY_MUSCLES } from '../lower-body'

describe('isLowerBodyMuscle', () => {
  it('recognises canonical + synonym leg muscles', () => {
    expect(isLowerBodyMuscle('quadriceps')).toBe(true) // synonym → quads
    expect(isLowerBodyMuscle('Glutes')).toBe(true)
    expect(isLowerBodyMuscle('hamstring')).toBe(true)
    expect(isLowerBodyMuscle('calves')).toBe(true)
    expect(isLowerBodyMuscle('legs')).toBe(true)
  })
  it('rejects upper-body muscles', () => {
    expect(isLowerBodyMuscle('chest')).toBe(false)
    expect(isLowerBodyMuscle('biceps')).toBe(false)
  })
  it('exposes the canonical set (normalized, lowercased)', () => {
    expect(LOWER_BODY_MUSCLES.has('quads')).toBe(true)
    expect(LOWER_BODY_MUSCLES.has('quadriceps')).toBe(false) // stores canonical only
  })
})
