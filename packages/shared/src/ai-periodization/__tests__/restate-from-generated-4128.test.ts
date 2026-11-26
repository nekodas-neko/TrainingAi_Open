// #4128: a lift's restate starts from what the generator made for it, never from an already-restated row.
// A range changed twice gives exactly what the final range chosen once gives; a range taken away gives the
// generated row back. Pure functions, no model (0 real calls); made-up lifts and numbers.
import { describe, it, expect } from 'vitest'
import { restatePlanRow, restatePlan, type RestatableRow } from '../lift-preference-restate'
import { applyLiftPreferenceToPlanRow } from '../lift-preference-plan'
import type { LiftPreference } from '../lift-preference'
import type { AiPrescription } from '../../types/ai-periodization'

const ctx = { trainingGoal: 'powerbuilding', phase: 'accumulation', role: 'secondary', bodyweight: false, basisKg: 100, equipment: ['Barbell'], budgetHeldRest: false }
type Row = RestatableRow & { sessionExerciseId: string; name: string }
const generatedRow: Row = { sessionExerciseId: 'se', name: 'Lift', sets: 3, reps: 8, pct: 70, restSec: 120 }
const at = new Date('2026-11-22T01:00:00.000Z')
const pref = (p: Partial<LiftPreference>): LiftPreference => ({ repRange: null, restSec: null, oneShot: null, ...p })
const RANGES = [
  { min: 3, max: 5 }, { min: 5, max: 8 }, { min: 6, max: 8 }, { min: 8, max: 10 },
  { min: 8, max: 12 }, { min: 10, max: 12 }, { min: 12, max: 15 }, { min: 15, max: 20 },
]
const withRange = (r: { min: number; max: number }, extra: Partial<LiftPreference> = {}) => pref({ repRange: r, ...extra })

/** What generation stores for the row with a range: the generated numbers plus the record the plan writes. */
function generate(r: { min: number; max: number } | null, row: Row = generatedRow): Row {
  if (!r) return row
  const { row: out, applied } = applyLiftPreferenceToPlanRow(row, withRange(r), ctx, { recordGenerated: true })
  return Object.keys(applied).length > 0 ? { ...out, liftPreference: applied } : out
}

describe('restate from what the generator made (#4128)', () => {
  it('every ordered pair of the 8 ranges: A then B is exactly B chosen once', () => {
    let pairs = 0
    for (const a of RANGES) for (const b of RANGES) {
      const twice = restatePlanRow(restatePlanRow(generatedRow, withRange(a), ctx), withRange(b), ctx)
      const once = restatePlanRow(generatedRow, withRange(b), ctx)
      expect(twice, `${a.min}-${a.max} then ${b.min}-${b.max}`).toEqual(once)
      pairs++
    }
    expect(pairs).toBe(64)
  })

  it('the production example: 12-15 then 8-10 is 8 reps at the 8-10 load, not 10', () => {
    const out = restatePlanRow(restatePlanRow(generatedRow, withRange({ min: 12, max: 15 }), ctx), withRange({ min: 8, max: 10 }), ctx)
    expect(out.reps).toBe(8)
    expect(out).toEqual(restatePlanRow(generatedRow, withRange({ min: 8, max: 10 }), ctx))
  })

  it('a change and its reversal return the generated row, for every range', () => {
    for (const r of RANGES) {
      const changed = restatePlanRow(generatedRow, withRange(r), ctx)
      expect(restatePlanRow(changed, null, ctx), `${r.min}-${r.max}`).toEqual(generatedRow)
      // A preference row that still exists but holds no range (the Coach undo of the first change, or a rest only).
      expect(restatePlanRow(changed, pref({}), ctx)).toEqual(generatedRow)
    }
  })

  it('a row generation stored with a range restates the same as one the Coach restated', () => {
    for (const a of RANGES) for (const b of RANGES) {
      const viaGeneration = restatePlanRow(generate(a), withRange(b), ctx)
      expect(viaGeneration, `${a.min}-${a.max} then ${b.min}-${b.max}`).toEqual(restatePlanRow(generatedRow, withRange(b), ctx))
    }
  })

  it('a range with a plate step and ±1 set on top still lands on the once-chosen row', () => {
    const shot = { oneShot: { loadStep: 'lighter' as const, setsDelta: 1 as const, setAt: at } }
    for (const a of RANGES) for (const b of RANGES) {
      const twice = restatePlanRow(restatePlanRow(generatedRow, withRange(a, shot), ctx), withRange(b, shot), ctx)
      expect(twice, `${a.min}-${a.max} then ${b.min}-${b.max}`).toEqual(restatePlanRow(generatedRow, withRange(b, shot), ctx))
    }
    // The one-shot used up, the range kept: the range alone again.
    const both = restatePlanRow(generatedRow, withRange({ min: 12, max: 15 }, shot), ctx)
    expect(restatePlanRow(both, withRange({ min: 12, max: 15 }), ctx)).toEqual(restatePlanRow(generatedRow, withRange({ min: 12, max: 15 }), ctx))
  })

  it('a row stored before the record existed is restated from the row, as before', () => {
    const old = { ...generatedRow, reps: 12, pct: 61.5, liftPreference: { repRange: { min: 12, max: 15 } } }
    expect(restatePlanRow(old, withRange({ min: 8, max: 10 }), ctx).reps).toBe(10)
  })

  it('a bodyweight lift keeps its load through two changes', () => {
    const bw = { ...ctx, bodyweight: true }
    const row = { ...generatedRow, pct: 0 }
    const twice = restatePlanRow(restatePlanRow(row, withRange({ min: 12, max: 15 }), bw), withRange({ min: 8, max: 10 }), bw)
    expect(twice).toEqual(restatePlanRow(row, withRange({ min: 8, max: 10 }), bw))
    expect(twice.pct).toBe(0)
  })

  it('a plan with no preference has no record: its bytes are what they were', () => {
    expect(JSON.stringify(restatePlanRow(generatedRow, null, ctx))).toBe(JSON.stringify(generatedRow))
    expect(restatePlanRow(generatedRow, pref({ restSec: 60 }), ctx).liftPreference).toEqual({ restSec: 60 })
  })

  it('the whole plan: two changes of one lift end where one change does, and the other lift is untouched', () => {
    const plan: AiPrescription = {
      phase: 'accumulation', phaseAction: 'continue', reasoning: 'r', confidence: 0.5, estimatedSessionDurationMin: 40, weeklyVolumeContribution: {},
      exercises: [
        { sessionExerciseId: 'se', name: 'Lift', sets: 3, reps: 8, pct: 70, restSec: 120 },
        { sessionExerciseId: 'other', name: 'Other', sets: 3, reps: 10, pct: 65, restSec: 90 },
      ],
    } as unknown as AiPrescription
    const inputs = { slots: [{ programSessionId: 'ps', sessionExerciseId: 'se', role: 'secondary' }], trainingGoal: 'powerbuilding', bodyweight: false, basisKg: 100, equipment: ['Barbell'] }
    const at1 = (p: AiPrescription, r: { min: number; max: number }) => restatePlan(inputs, { programSessionId: 'ps', phase: 'accumulation', prescription: p }, withRange(r))
    const twice = at1(at1(plan, { min: 12, max: 15 }), { min: 8, max: 10 })
    expect(twice).toEqual(at1(plan, { min: 8, max: 10 }))
    expect(twice.exercises[1]).toBe(plan.exercises[1])
    const back = restatePlan(inputs, { programSessionId: 'ps', phase: 'accumulation', prescription: at1(plan, { min: 12, max: 15 }) }, null)
    expect(back).toEqual(plan)
  })
})
