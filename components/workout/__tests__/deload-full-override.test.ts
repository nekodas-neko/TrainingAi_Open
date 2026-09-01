import { describe, expect, it } from 'vitest'
import { estimateOneRm } from '@trainingai/shared/1rm'
import {
  applyDeloadReverts,
  deloadOverrideBlocked,
  deloadRevertNames,
  isFullOverride,
} from '../utils'
import type { WorkoutExercise } from '@trainingai/shared/types/workout'

/**
 * BF-64. The Full/Deload toggle could only ever ADD a deload: `session-data.ts` applies the override
 * inside an `else if` that runs only when the prescription's exercise is not already deloaded. So
 * with a deload prescription, choosing `Full` changed nothing while the toggle read `Full · Override`
 * — the app offering a control that does nothing, which is worse than the BF-8 bug it descends from
 * (that was the toggle *disagreeing* with the card).
 */

const style = (useFor1rm: boolean) => [
  { pct: 80, reps: 5, restSec: 120, useFor1rm },
  { pct: 80, reps: 5, restSec: 120, useFor1rm },
]

function ex(name: string, o: Partial<WorkoutExercise> = {}): WorkoutExercise {
  return {
    name, deloaded: false, progressionStyle: style(true), defaultSets: 3,
    ...o,
  } as WorkoutExercise
}

describe('the override keys on an explicit choice, never on `deload === false`', () => {
  // The hazard is a frame, not a state: `deload` seeds false and only adopts the prescription in an
  // effect, so on first render it is false while the prescription is a deload. Keyed on `!deload`,
  // the session-level revert paints full weights and then snaps back.
  it('is off on first render, before the user has chosen anything', () => {
    expect(isFullOverride(false, true, false)).toBe(false)
  })

  it('is on once Full is explicitly chosen over a deload prescription', () => {
    expect(isFullOverride(true, true, false)).toBe(true)
  })

  it('is off when the choice is Deload, or when the prescription is not a deload', () => {
    expect(isFullOverride(true, true, true)).toBe(false)   // chose Deload
    expect(isFullOverride(true, false, false)).toBe(false) // full prescription: nothing to override
    expect(isFullOverride(true, undefined, false)).toBe(false) // no prescription yet
  })
})

describe('which exercises the override reverts', () => {
  const exercises = [
    ex('Bench', { deloaded: true, preDeloadStyle: style(false), preDeloadSets: 4 }),
    ex('Row',   { deloaded: true, preDeloadStyle: style(false), preDeloadSets: 5 }),
    // Deloaded, but the prescription recorded no pre-deload numbers for it.
    ex('Curl',  { deloaded: true }),
    ex('Fly'),  // never deloaded
  ]

  it('reverts every deloaded exercise that has pre-deload numbers', () => {
    expect(deloadRevertNames(exercises, [], true).sort()).toEqual(['Bench', 'Row'])
  })

  it('leaves the per-exercise reverts alone when the override is off', () => {
    expect(deloadRevertNames(exercises, ['Bench'], false)).toEqual(['Bench'])
  })

  it('does not duplicate an exercise the user already reverted by hand', () => {
    expect(deloadRevertNames(exercises, ['Bench'], true).sort()).toEqual(['Bench', 'Row'])
  })

  it('names the deloaded exercises it could NOT revert', () => {
    // Silently reverting some and not others, with nothing on screen saying which, is the failure
    // this fix would otherwise introduce while fixing the first one.
    expect(deloadOverrideBlocked(exercises, true)).toEqual(['Curl'])
    expect(deloadOverrideBlocked(exercises, false)).toEqual([])
  })

  it('actually swaps the weights and sets, and clears `deloaded`', () => {
    const out = applyDeloadReverts(exercises, deloadRevertNames(exercises, [], true))
    const bench = out.find(e => e.name === 'Bench')!
    expect(bench.deloaded).toBe(false)
    expect(bench.deloadReverted).toBe(true)
    expect(bench.defaultSets).toBe(4)
    expect(bench.progressionStyle).toEqual(style(false))
    // The one with no pre-deload numbers is untouched — the conservative answer.
    expect(out.find(e => e.name === 'Curl')!.deloaded).toBe(true)
  })
})

/**
 * The half that corrupts data if it is got backwards: a reverted exercise runs full weights so it
 * MUST count toward the 1RM, and an unreverted one must not. `fix/deload-provenance-and-previous-1rm`
 * already fixed one bug in this exact area, so it is live rather than hypothetical.
 */
describe('1RM accounting follows the revert', () => {
  const sets = [{ weightKg: 100, reps: 5 }, { weightKg: 100, reps: 5 }]
  const opts = { exerciseType: 'weighted' as const, isBaseline: false }

  // This mirrors `handleLogSet`'s gate. `deload` is false under an override, and the completion path
  // reads `effectiveExercises`, so the revert is what decides `ex.deloaded`.
  const gate = (exDeloaded: boolean, deload: boolean) => exDeloaded || (deload && !opts.isBaseline)

  it('counts a reverted exercise under an override', () => {
    const out = applyDeloadReverts(
      [ex('Bench', { deloaded: true, preDeloadStyle: style(false), preDeloadSets: 4 })],
      deloadRevertNames([ex('Bench', { deloaded: true, preDeloadStyle: style(false) })], [], true),
    )
    const deloaded = gate(out[0].deloaded === true, /* deload */ false)
    expect(deloaded).toBe(false)
    expect(estimateOneRm(sets, { ...opts, style: out[0].progressionStyle, deloaded }).estimated1rm).toBeGreaterThan(0)
  })

  it('does NOT count an exercise the override could not revert', () => {
    const out = applyDeloadReverts([ex('Curl', { deloaded: true })], deloadRevertNames([ex('Curl', { deloaded: true })], [], true))
    const deloaded = gate(out[0].deloaded === true, false)
    expect(deloaded).toBe(true)
    // Zero, not null: `estimateOneRm` short-circuits `if (deloaded) return { estimated1rm: 0, … }`.
    // Asserted against the real function rather than an assumption about it — the first version of
    // this line expected null and was wrong.
    expect(estimateOneRm(sets, { ...opts, style: out[0].progressionStyle, deloaded }).estimated1rm).toBe(0)
  })

  it('does NOT count anything when Deload is the choice', () => {
    const out = applyDeloadReverts([ex('Bench', { deloaded: true, preDeloadStyle: style(false) })], deloadRevertNames([], [], false))
    expect(gate(out[0].deloaded === true, /* deload */ true)).toBe(true)
  })
})
