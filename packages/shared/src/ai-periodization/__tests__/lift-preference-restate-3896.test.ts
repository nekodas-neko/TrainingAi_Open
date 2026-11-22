// #3896 step 5: restating a stored plan row for a changed preference, with no model call. The numbers
// must be the ones generation would store (`applyLiftPreferenceToPlanRow`, `applyPlanSetsDelta`), and a
// replaced one-shot must never be applied on top of the old one.
import { describe, it, expect } from 'vitest'
import { restatePlanRow, repRangeForRequest, type RestatableRow } from '../lift-preference-restate'
import { applyLiftPreferenceToPlanRow, preferredPct, roleLoadCapPct } from '../lift-preference-plan'
import { prescribedBar, weightStepFor } from '../../workout/load-rounding'
const PLATE = weightStepFor(['Barbell'])
import type { LiftPreference } from '../lift-preference'

const ctx = { trainingGoal: 'powerbuilding', phase: 'accumulation', role: 'secondary', bodyweight: false, basisKg: 100, equipment: ['Barbell'], budgetHeldRest: false }
const row: RestatableRow & { sessionExerciseId: string; name: string } = { sessionExerciseId: 'se', name: 'Lift', sets: 3, reps: 8, pct: 70, restSec: 120 }
const at = new Date('2026-11-22T01:00:00.000Z')
const pref = (p: Partial<LiftPreference>): LiftPreference => ({ repRange: null, restSec: null, oneShot: null, ...p })

describe('restatePlanRow', () => {
  it('a rep range: the same numbers generation stores', () => {
    const p = pref({ repRange: { min: 12, max: 15 } })
    const out = restatePlanRow(row, p, ctx)
    const gen = applyLiftPreferenceToPlanRow({ sets: 3, reps: 8, pct: 70, restSec: 120 }, p, ctx).row
    expect(out).toMatchObject({ sets: gen.sets, reps: gen.reps, pct: gen.pct, restSec: gen.restSec, liftPreference: { repRange: { min: 12, max: 15 } } })
    expect(out.pct).toBe(preferredPct('powerbuilding', 'accumulation', 'secondary', 12))
  })

  it('nothing to change returns the same object', () => {
    expect(restatePlanRow(row, null, ctx)).toBe(row)
    const deloaded = { ...row, deloaded: true }
    expect(restatePlanRow(deloaded, pref({ repRange: { min: 12, max: 15 } }), ctx)).toBe(deloaded)
  })

  it('a rest the time budget shortened stays the budget\'s', () => {
    const out = restatePlanRow(row, pref({ restSec: 60 }), { ...ctx, budgetHeldRest: true })
    expect(out).toBe(row)
    expect(restatePlanRow(row, pref({ restSec: 60 }), ctx)).toMatchObject({ restSec: 60, liftPreference: { restSec: 60 } })
  })

  it('a replaced plate step is taken back first: lighter then heavier lands one plate above the plan, not on it', () => {
    const lighter = restatePlanRow(row, pref({ oneShot: { loadStep: 'lighter', setsDelta: null, setAt: at } }), ctx)
    expect(prescribedBar(100, lighter.pct, ['Barbell'])).toBe(prescribedBar(100, 70, ['Barbell'])! - PLATE)
    const later = new Date(at.getTime() + 1000)
    const heavier = restatePlanRow(lighter, pref({ oneShot: { loadStep: 'heavier', setsDelta: null, setAt: later } }), ctx)
    expect(prescribedBar(100, heavier.pct, ['Barbell'])).toBe(prescribedBar(100, 70, ['Barbell'])! + PLATE)
    expect(heavier.liftPreference).toEqual({ loadStep: 'heavier', oneShotSetAt: later.toISOString() })
  })

  it('heavier past the role\'s top load is not applied and records nothing', () => {
    const top = { ...row, pct: roleLoadCapPct('powerbuilding', 'accumulation', 'secondary') }
    expect(restatePlanRow(top, pref({ oneShot: { loadStep: 'heavier', setsDelta: null, setAt: at } }), ctx)).toBe(top)
  })

  it('±1 set: applied once, taken back when replaced', () => {
    const plus = restatePlanRow(row, pref({ oneShot: { loadStep: null, setsDelta: 1, setAt: at } }), ctx)
    expect(plus).toMatchObject({ sets: 4, liftPreference: { setsDelta: 1, oneShotSetAt: at.toISOString() } })
    const minus = restatePlanRow(plus, pref({ oneShot: { loadStep: null, setsDelta: -1, setAt: at } }), ctx)
    expect(minus.sets).toBe(2)
    // The one-shot consumed: back to the plan as written.
    expect(restatePlanRow(plus, pref({}), ctx)).toMatchObject({ sets: 3 })
    expect(restatePlanRow(plus, null, ctx).liftPreference).toBeUndefined()
  })

  it('a bodyweight lift keeps its load', () => {
    const out = restatePlanRow({ ...row, pct: 0 }, pref({ repRange: { min: 12, max: 15 }, oneShot: { loadStep: 'lighter', setsDelta: null, setAt: at } }), { ...ctx, bodyweight: true })
    expect(out).toMatchObject({ reps: 12, pct: 0 })
    expect(out.liftPreference?.loadStep).toBeUndefined()
  })
})

describe('repRangeForRequest', () => {
  it('more reps is +4 with a span of 3 (6-8 → 10-13); fewer is -4', () => {
    expect(repRangeForRequest(6, 'more_reps')).toEqual({ min: 10, max: 13 })
    expect(repRangeForRequest(8, 'fewer_reps')).toEqual({ min: 4, max: 7 })
  })
  it('refuses past the table\'s limits rather than clamping', () => {
    expect(repRangeForRequest(24, 'more_reps')).toBeNull()
    expect(repRangeForRequest(4, 'fewer_reps')).toBeNull()
  })
})
