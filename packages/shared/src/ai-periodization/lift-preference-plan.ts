/**
 * The AI-phase half of a lift preference (#3896 step 4): how a preferred rep range sets the load in a
 * periodized plan. Used after the model by the AI path and by the rules fallback. Kept apart from
 * `lift-preference.ts` because it needs the phase zones in `prompt.ts`, which the static-style path
 * (and the web bundle that imports its types) does not.
 *
 * D3: the reps stay the person's; the phase moves the target effort, capped at the zone's top %.
 * D4: the load at the new reps is the role's target effort at those reps, through the existing
 * `pctForExpectedRpe`. No new formula: this is the accessory branch's existing rule (`settleAccessory`)
 * applied to any role, with the goal band swapped for the person's range. The per-role targets are the
 * ones generation already uses:
 *   - accessory: `accessoryTargetRpe(goal)`;
 *   - secondary: `min(accessoryTargetRpe, mainEffortCeiling)`;
 *   - primary: `mainEffortCeiling`, the effort of the phase zone's top % at its fewest reps.
 * The zone's % floor does not apply to a lift with a preference: 12 reps at a 72.5 % floor would be
 * near failure. The 40 % hard floor still does.
 */
import { intensityZoneForRole, phaseSetsMax } from './prompt'
import { accessoryTargetRpe } from './goal-ranges'
import { expectedRpe, pctForExpectedRpe } from './expected-rpe'
import { PCT_HARD_FLOOR } from './autoregulation'
import {
  clampReps, oneShotDue, pctOnePlateStep, setsWithDelta,
  type AppliedLiftPreference, type LiftPreference,
} from './lift-preference'

/** The existing accessory ceiling (`settleAccessory`'s 40-85 bound). */
const ACCESSORY_PCT_CEILING = 85

/** The main lift's hardest intended effort in this phase: the primary zone's top % at its fewest reps. */
export function mainEffortCeiling(trainingGoal: string, phase: string): number {
  const zone = intensityZoneForRole(trainingGoal, phase, 'primary')
  return expectedRpe(zone.pctMax, zone.repMin)
}

/** A secondary compound's effort floor: as hard as an accessory, never harder than the main lift. */
export function secondaryTargetRpe(trainingGoal: string, phase: string): number {
  return Math.min(accessoryTargetRpe(trainingGoal), mainEffortCeiling(trainingGoal, phase))
}

export function roleTargetRpe(trainingGoal: string, phase: string, role: string): number {
  if (role === 'accessory') return accessoryTargetRpe(trainingGoal)
  if (role === 'secondary') return secondaryTargetRpe(trainingGoal, phase)
  return mainEffortCeiling(trainingGoal, phase)
}

/** The top % a lift with a preference may carry: its role's zone top for the phase (accessories also
 *  keep their existing 85 % ceiling). A heavier one-shot is held to it as well. */
export function roleLoadCapPct(trainingGoal: string, phase: string, role: string): number {
  const top = intensityZoneForRole(trainingGoal, phase, role).pctMax
  return role === 'accessory' ? Math.min(ACCESSORY_PCT_CEILING, top) : top
}

/** D4: the load for `reps` at the role's target effort in this phase, capped (D3) and floored. */
export function preferredPct(trainingGoal: string, phase: string, role: string, reps: number): number {
  const pct = pctForExpectedRpe(roleTargetRpe(trainingGoal, phase, role), reps)
  return Math.min(roleLoadCapPct(trainingGoal, phase, role), Math.max(PCT_HARD_FLOOR, pct))
}

export interface PlanRow { sets: number; reps: number; pct: number; restSec: number }

export interface PlanPreferenceCtx {
  trainingGoal: string
  phase: string
  role: string
  bodyweight: boolean
  /** The working basis the bar is computed from (`resolveWorkingBasisWithSource`). Only the one-shot
   *  load step needs it; without one the step is not applied. */
  basisKg: number | null
  equipment: string[] | null
}

/**
 * Reps, load and rest for one prescribed exercise, plus the one-shot plate step. Sets are applied
 * separately (`applyPlanSetsDelta`) because they must come after the time budget, or its trim undoes
 * them. The caller never passes a deloaded row, a deload plan or a baseline.
 */
export function applyLiftPreferenceToPlanRow<R extends PlanRow>(
  row: R, pref: LiftPreference, ctx: PlanPreferenceCtx, opts: { recordGenerated?: boolean } = {},
): { row: R; applied: AppliedLiftPreference } {
  const applied: AppliedLiftPreference = {}
  let out = { ...row }
  if (pref.repRange) {
    const reps = clampReps(out.reps, pref.repRange)
    const pct = ctx.bodyweight ? out.pct : preferredPct(ctx.trainingGoal, ctx.phase, ctx.role, reps)
    if (reps !== out.reps || pct !== out.pct) {
      applied.repRange = pref.repRange
      // #4128: what the generator made, kept so a later restate starts from it. Opt-in: only the AI plan's
      // post-model step and the restate write it, so the rules fallback's rows stay byte for byte as they were.
      if (opts.recordGenerated) applied.generated = { reps: out.reps, pct: out.pct }
    }
    out = { ...out, reps, pct }
  }
  if (pref.restSec != null && pref.restSec !== out.restSec) {
    out = { ...out, restSec: pref.restSec }
    applied.restSec = pref.restSec
  }
  const shot = oneShotDue(pref, { deload: false, baseline: false })
  if (shot?.loadStep && !ctx.bodyweight) {
    const stepped = pctOnePlateStep(out.pct, ctx.basisKg, ctx.equipment, shot.loadStep, roleLoadCapPct(ctx.trainingGoal, ctx.phase, ctx.role))
    if (stepped != null) {
      out = { ...out, pct: stepped }
      applied.loadStep = shot.loadStep
      applied.oneShotSetAt = shot.setAt.toISOString()
    }
  }
  return { row: out, applied }
}

/**
 * The one-shot ±1 set, after the time budget. Returns the new count, or null when there is no set
 * one-shot or the role's bounds leave the count where it was.
 */
export function applyPlanSetsDelta(
  sets: number, pref: LiftPreference | null | undefined, ctx: { trainingGoal: string; phase: string; role: string },
): number | null {
  const shot = oneShotDue(pref, { deload: false, baseline: false })
  if (!shot?.setsDelta) return null
  return setsWithDelta(sets, shot.setsDelta, ctx.role, phaseSetsMax(ctx.trainingGoal, ctx.phase))
}

/** Merge what one step applied into what the row already records. */
export function mergeApplied(a: AppliedLiftPreference | undefined, b: AppliedLiftPreference): AppliedLiftPreference | undefined {
  const merged = { ...(a ?? {}), ...b }
  return Object.keys(merged).length > 0 ? merged : undefined
}
