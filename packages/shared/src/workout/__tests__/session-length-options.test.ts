// #2428 — the length picker offers 30/45/60/90 around the session's own budget and defaults to it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  sessionLengthOptions,
  presetForLength,
  requestedBudgetMin,
  budgetForPreset,
  durationDirection,
} from '@trainingai/shared/workout/duration-model'

describe('sessionLengthOptions', () => {
  it('is 30/45/60/90 for any anchor already on the ladder, so 45 is choosable', () => {
    for (const anchor of [30, 45, 60, 90]) expect(sessionLengthOptions(anchor)).toEqual([30, 45, 60, 90])
  })

  it('always offers four choices, sorted, and always includes the anchor', () => {
    for (const anchor of [20, 35, 50, 75, 80, 120]) {
      const opts = sessionLengthOptions(anchor)
      expect(opts).toHaveLength(4)
      expect(opts).toContain(anchor)
      expect([...opts].sort((a, b) => a - b)).toEqual(opts)
    }
  })

  it('an off-ladder anchor displaces the nearest rung (the lower on a tie)', () => {
    expect(sessionLengthOptions(75)).toEqual([30, 45, 75, 90])
    expect(sessionLengthOptions(52)).toEqual([30, 52, 60, 90])
  })
})

describe('defaults to the anchor', () => {
  it('picking the anchor sends exactly what the old Normal button sent', () => {
    expect(presetForLength(60, 60)).toBe('standard')
    expect(presetForLength(45, 45)).toBe('standard')
  })
  it('any other length is sent as absolute minutes', () => {
    expect(presetForLength(60, 45)).toBe(45)
    expect(presetForLength(60, 90)).toBe(90)
  })
  it('the stored default value selects the anchor in minutes', () => {
    expect(requestedBudgetMin(45, 'standard')).toBe(45)
  })
})

describe('same duration, same prescription inputs as today', () => {
  // The prescription depends only on the budget and direction these two return, so equal outputs
  // mean an identical prescription for the same duration.
  it.each([
    [60, 'short', 30], [60, 'standard', 60], [60, 'long', 90],
    [45, 'short', 15], [45, 'standard', 45], [45, 'long', 75],
  ] as const)('anchor %i, label %s equals %i minutes', (anchor, label, minutes) => {
    expect(budgetForPreset(anchor, minutes)).toBe(budgetForPreset(anchor, label))
    expect(durationDirection(anchor, minutes)).toBe(durationDirection(anchor, label))
  })
})

describe('commit on release', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../../../../../components/workout/session-duration-picker.tsx'), 'utf8')
  it('commits from click only, never from a pointer-move or drag handler', () => {
    expect(src).toMatch(/onClick=/)
    expect(src).not.toMatch(/onPointerMove|onTouchMove|onDrag|onValueChange|onInput/)
  })
})
