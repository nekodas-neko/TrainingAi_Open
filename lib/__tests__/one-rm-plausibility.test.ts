import { describe, it, expect } from 'vitest'
import { shouldCountTowardPr } from '@trainingai/shared/workout/log-exercise'
import { oneRmImplausible, MAX_PLAUSIBLE_ONE_RM_KG } from '@trainingai/shared/validation/plausibility'
import { calc1RM, calcAmrap1RM } from '@trainingai/shared/1rm'

const gate = (estimated1rm: number) =>
  shouldCountTowardPr({ estimated1rm, isAnyDeload: false, isBaseline: false, exerciseDeloaded: false })

describe('one-rep-max plausibility (Q-24 §7)', () => {
  it('the individually-legal payload really does produce an absurd 1RM', () => {
    // Both inputs pass their own schema bounds: weights <= 500, reps <= 100.
    // Measured, not quoted: 1612.75 kg. (The Q-24 entry says ~2,166 — that figure does not
    // match either 1RM path here; calc1RM gives 1612.75 and calcAmrap1RM 1322.5. The exact
    // number does not change the finding, since every one of them is impossible.)
    const absurd = calc1RM(500, 100)
    expect(absurd).toBeCloseTo(1612.75, 2)
    expect(oneRmImplausible(absurd)).toBe(true)
    expect(oneRmImplausible(calcAmrap1RM(500, 100))).toBe(true)
  })

  it('keeps an impossible estimate out of personal_records', () => {
    expect(gate(calc1RM(500, 100))).toBe(false)
    expect(gate(1e9)).toBe(false)
    expect(gate(Number.POSITIVE_INFINITY)).toBe(false)
    expect(gate(Number.NaN)).toBe(false)
  })

  it('accepts every real lift, including a world-class one', () => {
    // Heaviest deadlift ever is ~501 kg — the ceiling must sit clear of it.
    expect(gate(501)).toBe(true)
    expect(gate(MAX_PLAUSIBLE_ONE_RM_KG)).toBe(true)
    expect(gate(calc1RM(180, 5))).toBe(true)
    expect(gate(calc1RM(100, 12))).toBe(true)
  })

  it('leaves the existing deload and baseline gates untouched', () => {
    const base = { estimated1rm: 150, isBaseline: false, exerciseDeloaded: false }
    expect(shouldCountTowardPr({ ...base, isAnyDeload: true })).toBe(false)
    expect(shouldCountTowardPr({ ...base, isAnyDeload: true, isBaseline: true })).toBe(true)
    expect(shouldCountTowardPr({ ...base, isAnyDeload: false, exerciseDeloaded: true })).toBe(false)
    expect(shouldCountTowardPr({ ...base, isAnyDeload: false, estimated1rm: 0 })).toBe(false)
  })
})
