/**
 * #3896 step 5: a stored AI plan's row, restated for a lift's changed preference, with no model call.
 *
 * A plan is stored when it is generated, and generation applies the lift's preference after the model
 * (`applyLiftPreferenceToPlanRow`, `applyPlanSetsDelta`). When the Coach changes the preference, the
 * stored plan still carries the old one until it is regenerated. This puts the plan where generation
 * would have put it, through the same two functions, so the next workout shows the new numbers at once
 * (design §3a "On change": a deterministic re-clamp, like `refitPrescriptionToBudget`).
 *
 * Both the Coach's preview and its apply call this one function, so what the card shows is what is
 * stored; the readers (`normalizeStoredPrescription`, `buildWorkoutExercises`) then read it as any plan.
 *
 * What the row already applied is read from its own record (`liftPreference`):
 *   - a previous one-shot plate step is taken back first (the opposite plate step), and a previous ±1
 *     set is taken off, so a replaced one-shot is never applied on top of the old one;
 *   - a rep range sets the load outright (`preferredPct`), so a previous range needs no taking back;
 *   - a rest the time budget shortened (`refitBaseline.restSec` names the row) stays the budget's,
 *     as at generation (`appliedAfterBudgetRest`).
 * The Coach never removes a rep range or a rest (undo restores the stored plan as it was instead), so a
 * lasting field that is gone from the preference is left as the row has it.
 *
 * Pure. No new formula: every number comes from the step-4 functions.
 */
import {
  applyLiftPreferenceToPlanRow, applyPlanSetsDelta, roleLoadCapPct, type PlanPreferenceCtx,
} from './lift-preference-plan'
import { pctOnePlateStep, preferenceAppliesIn, type LiftPreference } from './lift-preference'
import { rewriteHeldRow, sameHoldRecord } from './checkin-plan-hold'
import type { AiPrescription, AppliedLiftPreference, PeriodizationPhase } from '../types/ai-periodization'

export interface RestatableRow {
  sets: number
  reps: number
  pct: number
  restSec: number
  deloaded?: boolean
  liftPreference?: AppliedLiftPreference
}

export interface RestateCtx extends PlanPreferenceCtx {
  /** The time budget shortened this row's rest, so its rest is the budget's, not the preference's. */
  budgetHeldRest: boolean
}

/**
 * The row as generation would store it with `pref`. Returns the same object when nothing changes.
 * A deloaded row is never touched: a preference does not apply in a deload.
 */
export function restatePlanRow<R extends RestatableRow>(row: R, pref: LiftPreference | null, ctx: RestateCtx): R {
  if (row.deloaded) return row
  const prev = row.liftPreference
  let base = { ...row }

  // Take back what the row's previous one-shot did, so the new state is applied to the plan as written.
  if (prev?.loadStep && !ctx.bodyweight) {
    const back = prev.loadStep === 'lighter' ? 'heavier' : 'lighter'
    const pct = pctOnePlateStep(base.pct, ctx.basisKg, ctx.equipment, back, back === 'heavier' ? roleLoadCapPct(ctx.trainingGoal, ctx.phase, ctx.role) : Infinity)
    if (pct != null) base = { ...base, pct }
  }
  if (prev?.setsDelta) base = { ...base, sets: Math.max(1, base.sets - prev.setsDelta) }

  if (!pref) {
    const { liftPreference: _gone, ...rest } = base
    return sameRow(row, rest as R) ? row : (rest as R)
  }

  const { row: out, applied } = applyLiftPreferenceToPlanRow(
    { sets: base.sets, reps: base.reps, pct: base.pct, restSec: base.restSec }, pref, ctx,
  )
  const restSec = ctx.budgetHeldRest ? base.restSec : out.restSec
  const sets = applyPlanSetsDelta(out.sets, pref, ctx) ?? out.sets

  const record: AppliedLiftPreference = {}
  if (pref.repRange && (applied.repRange || prev?.repRange)) record.repRange = pref.repRange
  if (pref.restSec != null && restSec === pref.restSec && (applied.restSec != null || prev?.restSec != null)) record.restSec = pref.restSec
  if (applied.loadStep) record.loadStep = applied.loadStep
  if (sets !== out.sets) record.setsDelta = pref.oneShot!.setsDelta!
  if (record.loadStep || record.setsDelta) record.oneShotSetAt = pref.oneShot!.setAt.toISOString()

  const { liftPreference: _old, ...plain } = base
  const next = {
    ...plain, sets, reps: out.reps, pct: out.pct, restSec,
    ...(Object.keys(record).length > 0 && { liftPreference: record }),
  } as R
  return sameRow(row, next) ? row : next
}

function sameRow(a: RestatableRow, b: RestatableRow): boolean {
  return a.sets === b.sets && a.reps === b.reps && a.pct === b.pct && a.restSec === b.restSec
    && JSON.stringify(a.liftPreference ?? null) === JSON.stringify(b.liftPreference ?? null)
}

/** A plan a preference never applies in: a deload, or the baseline test (design §3a). */
export function planExcluded(plan: { phase: PeriodizationPhase; prescription: AiPrescription }): 'deload' | 'baseline' | null {
  const deload = plan.prescription.deload === true || plan.prescription.phase === 'deload'
  const baseline = plan.phase === 'baseline'
  if (preferenceAppliesIn({ deload, baseline })) return null
  return baseline ? 'baseline' : 'deload'
}

/** What `restatePlan` needs of one lift: its slots in the plan's session, and the facts its rows are costed from. */
export interface RestateInputs {
  slots: readonly { programSessionId: string; sessionExerciseId: string; role: string }[]
  trainingGoal: string
  bodyweight: boolean
  basisKg: number | null
  equipment: string[] | null
}

/**
 * The plan as generation would store it with `pref`, or the same object when nothing changes. The one
 * function that restates a whole stored plan for ONE lift's changed preference: the Coach's preview and
 * apply call it (`lib/coach/domains/lift-preference.ts`), and so does a generation that finds a lift's
 * preference moved while the model was answering (`restateForMovedPreferences`, #4007).
 */
export function restatePlan(ctx: RestateInputs, plan: { programSessionId: string; phase: PeriodizationPhase; prescription: AiPrescription }, pref: LiftPreference | null): AiPrescription {
  if (planExcluded(plan)) return plan.prescription
  const slotIds = new Map(ctx.slots.filter(x => x.programSessionId === plan.programSessionId).map(x => [x.sessionExerciseId, x.role]))
  let changed = false
  // #3890: a row the weekly check-in's hold lowered is restated from its own load, with the hold's
  // ceiling put back over it (`rewriteHeldRow`), so the plan is still held and still knows its own load.
  const hold = plan.prescription.checkinHold
  const heldRows: NonNullable<AiPrescription['checkinHold']>['rows'] = { ...hold?.rows }
  const exercises = plan.prescription.exercises.map(ex => {
    const role = slotIds.get(ex.sessionExerciseId)
    if (!role) return ex
    const { row: out, held } = rewriteHeldRow(ex, hold, row => restatePlanRow(row, pref, {
      trainingGoal: ctx.trainingGoal, phase: plan.prescription.phase, role,
      bodyweight: ctx.bodyweight, basisKg: ctx.basisKg, equipment: ctx.equipment,
      budgetHeldRest: plan.prescription.refitBaseline?.restSec?.[ex.sessionExerciseId] != null,
    }))
    if (hold?.rows[ex.sessionExerciseId]) {
      if (held) heldRows[ex.sessionExerciseId] = held
      else delete heldRows[ex.sessionExerciseId]
    }
    if (out !== ex) changed = true
    return out
  })
  if (hold && !sameHoldRecord({ ...hold, rows: heldRows }, hold)) changed = true
  if (!changed) return plan.prescription
  const { checkinHold: _hold, ...rest } = plan.prescription
  return { ...rest, exercises, ...(hold && Object.keys(heldRows).length > 0 && { checkinHold: { ...hold, rows: heldRows } }) }
}

/**
 * The range "more reps" or "fewer reps" means, worked out by code (design §3a: "the reps of the last
 * plan + 4, with a span of 3", so 6-8 becomes 10-13). `baseMin` is the low end the person trains at
 * now: their range when they have one, otherwise the next plan's reps. Null when the step would leave
 * the table's 1-30 limits; the caller refuses with a plain message rather than clamping.
 */
export const REP_REQUEST_STEP = 4
export const REP_REQUEST_SPAN = 3
export function repRangeForRequest(baseMin: number, request: 'more_reps' | 'fewer_reps'): { min: number; max: number } | null {
  const min = request === 'more_reps' ? baseMin + REP_REQUEST_STEP : baseMin - REP_REQUEST_STEP
  const max = min + REP_REQUEST_SPAN
  if (!Number.isInteger(min) || min < 1 || max > 30) return null
  return { min, max }
}
