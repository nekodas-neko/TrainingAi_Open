import { describe, it, expect } from 'vitest'
import { barIsCapped, initialSetWeight, mroundStep, mroundStepUp, prescribedBar, weightStepFor } from '../load-rounding'

describe('load rounding', () => {
  it('steps 2.5 kg on a barbell and 1.25 kg on anything else', () => {
    expect(weightStepFor(['barbell'])).toBe(2.5)
    expect(weightStepFor(['dumbbell'])).toBe(1.25)
    expect(weightStepFor(null)).toBe(1.25)
  })
  it('rounds to the step inside the 5–250 kg bar range', () => {
    expect(mroundStep(61.2, 2.5)).toBe(60)
    expect(mroundStepUp(60.1, 2.5)).toBe(62.5)
    expect(mroundStepUp(1, 2.5)).toBe(5)
    expect(mroundStepUp(300, 2.5)).toBe(250)
    expect(barIsCapped(251)).toBe(true)
    expect(barIsCapped(250)).toBe(false)
  })
  it('prescribes the style percentage of the basis, rounded up', () => {
    expect(prescribedBar(100, 72, ['barbell'])).toBe(72.5)
    expect(prescribedBar(null, 72, ['barbell'])).toBeNull()
  })
  it('opens a set on the prescribed bar, then target, then 80% of 1RM, then last load, then 60', () => {
    const ex = { exerciseType: 'weighted', equipment: ['barbell'], target80: 81, estimated1rm: 100, latestWeight: 61 }
    expect(initialSetWeight(ex, 70)).toBe(70)
    expect(initialSetWeight(ex, null)).toBe(82.5)
    expect(initialSetWeight({ ...ex, target80: null }, null)).toBe(80)
    expect(initialSetWeight({ ...ex, target80: null, estimated1rm: null }, null)).toBe(60)
    expect(initialSetWeight({ ...ex, target80: null, estimated1rm: null, latestWeight: null }, null)).toBe(60)
    expect(initialSetWeight({ ...ex, exerciseType: 'bodyweight' }, 70)).toBe(0)
  })
})
